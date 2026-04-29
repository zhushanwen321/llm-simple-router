#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { randomUUID } from "crypto";
import Fastify, { FastifyInstance } from "fastify";
import { insertRequestLog } from "./db/logs.js";
import { HTTP_NOT_FOUND, HTTP_INTERNAL_ERROR, getProxyApiType } from "./constants.js";
import { API_CODE, ApiResponse, apiError, isAdminApiResponse, statusToApiCode } from "./admin/api-response.js";

const PROVIDER_DEFAULT_QUEUE_TIMEOUT_MS = 5000;
const PROVIDER_DEFAULT_MAX_QUEUE_SIZE = 100;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { getConfig, Config } from "./config.js";
import { initDatabase, getAllProviders, backfillMetricsFromRequestMetrics } from "./db/index.js";
import { loadRecommendedConfig } from "./config/recommended.js";
import { authMiddleware } from "./middleware/auth.js";
import { openaiProxy } from "./proxy/openai.js";
import { anthropicProxy } from "./proxy/anthropic.js";
import { adminRoutes } from "./admin/routes.js";
import { RetryRuleMatcher } from "./proxy/retry-rules.js";
import { ProviderSemaphoreManager } from "./proxy/semaphore.js";
import { AdaptiveConcurrencyController } from "./proxy/adaptive-controller.js";
import { RequestTracker } from "./monitor/request-tracker.js";
import { modelState } from "./proxy/model-state.js";
import { UsageWindowTracker } from "./proxy/usage-window-tracker.js";
import { SessionTracker } from "./proxy/loop-prevention/session-tracker.js";
import { DEFAULT_LOOP_PREVENTION_CONFIG } from "./proxy/loop-prevention/types.js";
import { scheduleLogCleanup } from "./db/log-cleaner.js";
import { scheduleDbSizeMonitor } from "./db/db-size-monitor.js";
import { startUpgradeChecker, stopUpgradeChecker } from "./admin/upgrade.js";
import { CheckerOptions } from "./upgrade/checker.js";
import fastifyStatic from "@fastify/static";
import Database from "better-sqlite3";

export interface AppOptions {
  config?: Config;
  db?: Database.Database;
  upgradeCheckerOptions?: CheckerOptions;
}

export async function buildApp(
  options?: AppOptions
): Promise<{
  app: FastifyInstance;
  db: Database.Database;
  usageWindowTracker: UsageWindowTracker;
  close: () => Promise<void>;
}> {
  const config = options?.config ?? getBaseConfig();

  // 允许外部传入已初始化的 DB（测试用），否则自行创建
  let db: Database.Database;
  let shouldBackfill = false;
  if (options?.db) {
    db = options.db;
  } else {
    db = initDatabase(config.DB_PATH);
    shouldBackfill = true;
  }

  const isDev = process.env.NODE_ENV !== "production";

  const MAX_BODY_SIZE_MB = 50;
  const KB = 1024;
  const MB = KB * KB;

  const app = Fastify({
    // Claude Code 图片请求含 base64 编码，单张可达数十 MB
    bodyLimit: MAX_BODY_SIZE_MB * MB,
    logger: {
      level: config.LOG_LEVEL,
      ...(isDev
        ? {
          transport: {
            target: "pino-pretty",
            options: {
              translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
              ignore: "pid,hostname",
            },
          },
        }
        : {}),
    },
    // 统一 schema validation 错误格式为 { error: { message } }
    ajv: {
      customOptions: {
        messages: true,
      },
    },
  });

  app.setSchemaErrorFormatter((errors) => {
    const message = errors
      .map((e) => {
        const field = e.instancePath ? e.instancePath.slice(1) : e.params?.missingProperty ?? "field";
        return `${field} ${e.message}`;
      })
      .join("; ");
    return new Error(message);
  });

  // 记录请求到达时间，供全局错误处理计算延迟
  app.addHook("onRequest", (request, _reply, done) => {
    (request as unknown as { receivedAt: number }).receivedAt = Date.now();
    done();
  });

  // 统一错误处理：代理路由保持 {error:{message}}，Admin API 使用信封格式
  app.setErrorHandler((error: Error, request, reply) => {
    const fastifyError = error as Error & { statusCode?: number; validation?: unknown[] };
    const status = fastifyError.statusCode ?? HTTP_INTERNAL_ERROR;

    // 代理路由保持原有格式，并记录到 request_logs
    if (!isAdminApiResponse(request.url)) {
      const proxyApiType = getProxyApiType(request.url);
      if (proxyApiType) {
        request.log.error({ statusCode: status, err: error }, `Proxy request error: ${fastifyError.message}`);
        const body = request.body as Record<string, unknown> | undefined;
        const receivedAt = (request as unknown as { receivedAt?: number }).receivedAt;
        const latencyMs = receivedAt ? Date.now() - receivedAt : 0;
        insertRequestLog(db, {
          id: randomUUID(),
          api_type: proxyApiType,
          model: (body?.model as string) || null,
          provider_id: null,
          status_code: status,
          latency_ms: latencyMs,
          is_stream: body?.stream === true ? 1 : 0,
          error_message: fastifyError.message,
          created_at: new Date().toISOString(),
          client_request: JSON.stringify({ headers: request.headers, ...(body ? { body } : {}) }),
          router_key_id: request.routerKey?.id ?? null,
        });
      }
      return reply.code(status).send({ error: { message: fastifyError.message } });
    }

    // Admin API — 统一信封错误格式
    const code = statusToApiCode(status);
    return reply.code(status).send(apiError(code, fastifyError.message));
  });

  // onSend hook：自动包装 Admin API 成功响应为信封格式
  app.addHook('onSend', async (request, reply, payload) => {
    if (!isAdminApiResponse(request.url, reply.getHeader('content-type') as string | undefined)) {
      return payload
    }

    // 已是错误信封（errorHandler 已包装）或已是信封格式 — 跳过
    if (typeof payload === 'string') {
      try {
        const parsed = JSON.parse(payload)
        if ('code' in parsed) return payload // errorHandler 或路由已手动包装
      } catch {
        return payload
      }
    }

    // 包装成功响应
    const wrapped: ApiResponse<unknown> = {
      code: API_CODE.SUCCESS,
      message: 'ok',
      data: typeof payload === 'string' ? JSON.parse(payload) : payload,
    }
    return JSON.stringify(wrapped)
  })

  loadRecommendedConfig();
  startUpgradeChecker(options?.upgradeCheckerOptions);

  // 启动时回填：补齐回退老版本期间缺失的 metrics 冗余列
  if (shouldBackfill) {
    const backfilled = backfillMetricsFromRequestMetrics(db);
    if (backfilled > 0) {
      app.log.info({ backfilled }, "Backfilled metrics from request_metrics");
    }
  }

  // 注入 DB 到 modelState 单例，启用会话级持久化
  modelState.init(db);
  const matcher = new RetryRuleMatcher();
  matcher.load(db);

  const semaphoreManager = new ProviderSemaphoreManager();
  const tracker = new RequestTracker({ semaphoreManager, logger: app.log });
  tracker.startPushInterval();

  const adaptiveController = new AdaptiveConcurrencyController(semaphoreManager, app.log);
  tracker.setAdaptiveController(adaptiveController);

  // 5h 用量窗口追踪器，启动时自动补齐缺失窗口
  const usageWindowTracker = new UsageWindowTracker(db);
  usageWindowTracker.reconcileOnStartup();

  // Session tracker（工具调用循环检测用），始终创建但检测受 proxy_enhancement 配置控制
  const sessionTracker = new SessionTracker(DEFAULT_LOOP_PREVENTION_CONFIG.sessionTracker);

  // 从 DB 读取已有 provider 的并发配置，初始化信号量管理器和 tracker
  const allProviders = getAllProviders(db);
  for (const p of allProviders) {
    if (p.adaptive_enabled) {
      adaptiveController.init(p.id, { max: p.max_concurrency }, {
        queueTimeoutMs: p.queue_timeout_ms,
        maxQueueSize: p.max_queue_size,
      });
    } else if (p.max_concurrency > 0) {
      semaphoreManager.updateConfig(p.id, {
        maxConcurrency: p.max_concurrency,
        queueTimeoutMs: p.queue_timeout_ms,
        maxQueueSize: p.max_queue_size,
      });
    }
    tracker.updateProviderConfig(p.id, {
      name: p.name,
      maxConcurrency: p.max_concurrency ?? 0,
      queueTimeoutMs: p.queue_timeout_ms ?? PROVIDER_DEFAULT_QUEUE_TIMEOUT_MS,
      maxQueueSize: p.max_queue_size ?? PROVIDER_DEFAULT_MAX_QUEUE_SIZE,
    });
  }

  app.register(authMiddleware, { db });
  app.register(openaiProxy, {
    db,
    streamTimeoutMs: config.STREAM_TIMEOUT_MS,
    retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
    matcher,
    semaphoreManager,
    tracker,
    usageWindowTracker,
    sessionTracker,
    adaptiveController,
  });
  app.register(anthropicProxy, {
    db,
    streamTimeoutMs: config.STREAM_TIMEOUT_MS,
    retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
    matcher,
    semaphoreManager,
    tracker,
    usageWindowTracker,
    sessionTracker,
    adaptiveController,
  });

  app.register(adminRoutes, { db, matcher, tracker, semaphoreManager, adaptiveController });

  // 前端静态文件服务（生产环境）
  const frontendDist = path.resolve(
    process.env.FRONTEND_DIST || path.join(__dirname, "../frontend-dist")
  );

  if (existsSync(frontendDist)) {
    app.register(fastifyStatic, {
      root: frontendDist,
      prefix: "/admin/",
      wildcard: false,
    });

    // SPA fallback: /admin/ 下非 API 路径返回 index.html
    app.setNotFoundHandler((request, reply) => {
      if (
        request.url.startsWith("/admin") &&
        !request.url.startsWith("/admin/api")
      ) {
        return reply.sendFile("index.html");
      }
      reply.code(HTTP_NOT_FOUND).send({ error: { message: "Not Found" } });
    });
  } else {
    app.log.warn(
      `Frontend dist not found at ${frontendDist}, skipping static serving`
    );
  }

  app.get("/health", async () => {
    return { status: "ok" };
  });

  const logCleanup = scheduleLogCleanup(db, app.log);

  const dbSizeMonitor = scheduleDbSizeMonitor(db, config.DB_PATH, {
    log: app.log,
  });

  return {
    app,
    db,
    usageWindowTracker,
    close: async () => {
      stopUpgradeChecker();
      logCleanup.stop();
      dbSizeMonitor.stop();
      tracker.stopPushInterval();
      sessionTracker.stop();
      await app.close();
      db.close();
    },
  };
}

// index.ts 自身也需要 getBaseConfig，避免循环依赖
import { getBaseConfig } from "./config.js";

export async function main() {
  const { app } = await buildApp();
  const config = getConfig();

  try {
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    app.log.info(`Server listening on port ${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// 开发时直接运行 tsx src/index.ts 仍可启动
const isMainModule = process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts");
if (isMainModule) {
  main();
}

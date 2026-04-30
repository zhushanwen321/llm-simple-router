#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { randomUUID } from "crypto";
import Fastify, { FastifyInstance } from "fastify";
import { insertRequestLog } from "./db/logs.js";
import { HTTP_NOT_FOUND, HTTP_INTERNAL_ERROR, getProxyApiType } from "./core/constants.js";
import { API_CODE, ApiResponse, apiError, isAdminApiResponse, statusToApiCode } from "./admin/api-response.js";

const PROVIDER_DEFAULT_QUEUE_TIMEOUT_MS = 5000;
const PROVIDER_DEFAULT_MAX_QUEUE_SIZE = 100;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { getConfig, getBaseConfig, Config } from "./config/index.js";
import { initDatabase, getAllProviders, backfillMetricsFromRequestMetrics } from "./db/index.js";
import { loadRecommendedConfig } from "./config/recommended.js";
import { authMiddleware } from "./middleware/auth.js";
import { openaiProxy } from "./proxy/handler/openai.js";
import { anthropicProxy } from "./proxy/handler/anthropic.js";
import { adminRoutes } from "./admin/routes.js";
import { RetryRuleMatcher } from "./proxy/orchestration/retry-rules.js";
import { ProviderSemaphoreManager } from "./proxy/orchestration/semaphore.js";
import { AdaptiveConcurrencyController } from "./proxy/adaptive-controller.js";
import { loadEnhancementConfig } from "./proxy/routing/enhancement-config.js";
import type { StateRegistry } from "./core/registry.js";
import { RequestTracker } from "./monitor/request-tracker.js";
import { modelState } from "./proxy/routing/model-state.js";
import { UsageWindowTracker } from "./proxy/routing/usage-window-tracker.js";
import { SessionTracker } from "./proxy/loop-prevention/session-tracker.js";
import { DEFAULT_LOOP_PREVENTION_CONFIG } from "./proxy/loop-prevention/types.js";
import { scheduleLogCleanup } from "./db/log-cleaner.js";
import { scheduleDbSizeMonitor } from "./db/db-size-monitor.js";
import { startUpgradeChecker, stopUpgradeChecker } from "./admin/upgrade.js";
import { CheckerOptions } from "./upgrade/checker.js";
import fastifyStatic from "@fastify/static";
import { ServiceContainer, SERVICE_KEYS } from "./core/container.js";
import Database from "better-sqlite3";

export interface AppOptions {
  config?: Config;
  db?: Database.Database;
  upgradeCheckerOptions?: CheckerOptions;
}

/**
 * 共享初始化逻辑 — 启动时和导入配置后都需要调用。
 * 从 DB 读取所有 provider，初始化信号量/自适应并发/tracker 缓存。
 */
export function initializeProviderState(
  db: Database.Database,
  semaphoreManager: ProviderSemaphoreManager,
  adaptiveController: AdaptiveConcurrencyController,
  tracker: RequestTracker,
): void {
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
        if (parsed !== null && typeof parsed === 'object' && 'code' in parsed) return payload // errorHandler 或路由已手动包装
        // 复用已解析结果，避免二次 JSON.parse
        const wrapped: ApiResponse<unknown> = {
          code: API_CODE.SUCCESS,
          message: 'ok',
          data: parsed,
        }
        return JSON.stringify(wrapped)
      } catch {
        return payload
      }
    }

    return payload
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

  const container = new ServiceContainer();
  container.register(SERVICE_KEYS.db, () => db);
  container.register(SERVICE_KEYS.matcher, (c) => { const m = new RetryRuleMatcher(); m.load(c.resolve(SERVICE_KEYS.db)); return m; });
  container.register(SERVICE_KEYS.semaphoreManager, () => new ProviderSemaphoreManager());
  container.register(SERVICE_KEYS.tracker, (c) => {
    const t = new RequestTracker({ semaphoreManager: c.resolve(SERVICE_KEYS.semaphoreManager), logger: app.log });
    t.startPushInterval();
    return t;
  });
  container.register(SERVICE_KEYS.usageWindowTracker, (c) => {
    const uwt = new UsageWindowTracker(c.resolve(SERVICE_KEYS.db));
    uwt.reconcileOnStartup();
    return uwt;
  });
  container.register(SERVICE_KEYS.sessionTracker, () => new SessionTracker(DEFAULT_LOOP_PREVENTION_CONFIG.sessionTracker));

  // 注入 DB 到 modelState 单例，启用会话级持久化
  modelState.init(db);

  // 注册 AdaptiveConcurrencyController（依赖已注册的 semaphoreManager）
  container.register(SERVICE_KEYS.adaptiveController, (c) => {
    const ac = new AdaptiveConcurrencyController(c.resolve(SERVICE_KEYS.semaphoreManager), app.log);
    return ac;
  });

  // 从容器解析所有服务
  const matcher = container.resolve<RetryRuleMatcher>(SERVICE_KEYS.matcher);
  const semaphoreManager = container.resolve<ProviderSemaphoreManager>(SERVICE_KEYS.semaphoreManager);
  const tracker = container.resolve<RequestTracker>(SERVICE_KEYS.tracker);
  const usageWindowTracker = container.resolve<UsageWindowTracker>(SERVICE_KEYS.usageWindowTracker);
  const adaptiveController = container.resolve<AdaptiveConcurrencyController>(SERVICE_KEYS.adaptiveController);

  // Wire adaptive controller to tracker
  tracker.setAdaptiveController(adaptiveController);

  // 从 DB 读取已有 provider 的并发配置，初始化信号量/adaptive/tracker（共享逻辑）
  initializeProviderState(db, semaphoreManager, adaptiveController, tracker);

  app.register(authMiddleware, { db });
  app.register(openaiProxy, { db, container });
  app.register(anthropicProxy, { db, container });

  // StateRegistry — Admin 层通过此接口触发 proxy 层状态刷新，消除 admin→proxy 依赖
  const stateRegistry: StateRegistry = {
    refreshRetryRules: () => matcher.load(db),
    updateProviderConcurrency: (providerId, cfg) => semaphoreManager.updateConfig(providerId, cfg),
    removeProvider: (providerId) => semaphoreManager.remove(providerId),
    removeAllProviders: () => semaphoreManager.removeAll(),
    getProviderStatus: (providerId) => semaphoreManager.getStatus(providerId),
    clearModelState: () => modelState.clearAll(),
    deleteModelState: (keyId, sessionId) => modelState.delete(keyId, sessionId),
    getEnhancementConfig: () => loadEnhancementConfig(db),
    syncAdaptiveProvider: (providerId, cfg) => adaptiveController.syncProvider(providerId, cfg),
    removeAdaptiveProvider: (providerId) => adaptiveController.remove(providerId),
    getAdaptiveStatus: (providerId) => adaptiveController.getStatus(providerId),
    reinitializeProviders: () => {
      adaptiveController.removeAll();
      initializeProviderState(db, semaphoreManager, adaptiveController, tracker);
    },
  };

  app.register(adminRoutes, { db, stateRegistry, tracker, adaptiveController });

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
      modelState.clearAll();
      semaphoreManager.removeAll();
      const sessionTracker = container.resolve<SessionTracker>(SERVICE_KEYS.sessionTracker);
      sessionTracker.stop();
      await app.close();
      db.close();
    },
  };
}

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

#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { randomUUID } from "crypto";
import Fastify, { FastifyInstance } from "fastify";
import { insertRequestLog } from "./db/logs.js";
import { HTTP_NOT_FOUND, HTTP_INTERNAL_ERROR, HTTP_BAD_REQUEST } from "./constants.js";

const PROVIDER_DEFAULT_QUEUE_TIMEOUT_MS = 5000;
const PROVIDER_DEFAULT_MAX_QUEUE_SIZE = 100;

// 代理路由路径 → api_type，用于在全局 hook/errorHandler 中识别代理请求
const PROXY_API_TYPES: Record<string, string> = {
  "/v1/chat/completions": "openai",
  "/v1/messages": "anthropic",
  "/v1/models": "openai",
};

function getProxyApiType(url: string): string | null {
  const path = url.split("?")[0];
  return PROXY_API_TYPES[path] ?? null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { getConfig, Config } from "./config.js";
import { initDatabase, getAllProviders } from "./db/index.js";
import { loadRecommendedConfig } from "./config/recommended.js";
import { authMiddleware } from "./middleware/auth.js";
import { openaiProxy } from "./proxy/openai.js";
import { anthropicProxy } from "./proxy/anthropic.js";
import { adminRoutes } from "./admin/routes.js";
import { RetryRuleMatcher } from "./proxy/retry-rules.js";
import { ProviderSemaphoreManager } from "./proxy/semaphore.js";
import { RequestTracker } from "./monitor/request-tracker.js";
import { modelState } from "./proxy/model-state.js";
import { UsageWindowTracker } from "./proxy/usage-window-tracker.js";
import fastifyStatic from "@fastify/static";
import Database from "better-sqlite3";

export interface AppOptions {
  config?: Config;
  db?: Database.Database;
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
  if (options?.db) {
    db = options.db;
  } else {
    db = initDatabase(config.DB_PATH);
  }

  const isDev = process.env.NODE_ENV !== "production";

  const app = Fastify({
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

  // 统一 schema validation 错误响应格式，代理路由的错误也记录到 request_logs
  app.setErrorHandler((error: Error, request, reply) => {
    const fastifyError = error as Error & { statusCode?: number; validation?: unknown[] };
    const status = fastifyError.statusCode ?? HTTP_INTERNAL_ERROR;

    const proxyApiType = getProxyApiType(request.url);
    if (proxyApiType) {
      request.log.error({ statusCode: status, err: error }, `Proxy request error: ${fastifyError.message}`);
      const body = request.body as Record<string, unknown> | undefined;
      insertRequestLog(db, {
        id: randomUUID(),
        api_type: proxyApiType,
        model: (body?.model as string) || null,
        provider_id: null,
        status_code: status,
        latency_ms: 0,
        is_stream: 0,
        error_message: fastifyError.message,
        created_at: new Date().toISOString(),
        client_request: JSON.stringify({ headers: request.headers }),
        router_key_id: request.routerKey?.id ?? null,
      });
    }

    if (status === HTTP_BAD_REQUEST && fastifyError.validation) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: { message: fastifyError.message } });
    }
    return reply.code(status).send({ error: { message: fastifyError.message } });
  });

  loadRecommendedConfig();

  // 注入 DB 到 modelState 单例，启用会话级持久化
  modelState.init(db);
  const matcher = new RetryRuleMatcher();
  matcher.load(db);

  const semaphoreManager = new ProviderSemaphoreManager();
  const tracker = new RequestTracker({ semaphoreManager, logger: app.log });
  tracker.startPushInterval();

  // 5h 用量窗口追踪器，启动时自动补齐缺失窗口
  const usageWindowTracker = new UsageWindowTracker(db);
  usageWindowTracker.reconcileOnStartup();

  // 从 DB 读取已有 provider 的并发配置，初始化信号量管理器和 tracker
  const allProviders = getAllProviders(db);
  for (const p of allProviders) {
    if (p.max_concurrency > 0) {
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
    retryMaxAttempts: config.RETRY_MAX_ATTEMPTS,
    retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
    matcher,
    semaphoreManager,
    tracker,
  });
  app.register(anthropicProxy, {
    db,
    streamTimeoutMs: config.STREAM_TIMEOUT_MS,
    retryMaxAttempts: config.RETRY_MAX_ATTEMPTS,
    retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
    matcher,
    semaphoreManager,
    tracker,
  });

  app.register(adminRoutes, { db, matcher, tracker, semaphoreManager });

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

  return {
    app,
    db,
    usageWindowTracker,
    close: async () => {
      tracker.stopPushInterval();
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

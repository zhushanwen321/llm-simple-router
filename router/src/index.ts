#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { getConfig, getBaseConfig, type Config } from "./config/index.js";
import { initDatabase, getAllProviders } from "./db/index.js";
import { SemaphoreManager, AdaptiveController } from "./core/concurrency/index.js";
import { RequestTracker } from "./core/monitor/index.js";
import { UsageWindowTracker } from "./proxy/routing/usage-window-tracker.js";
import { CheckerOptions } from "./upgrade/checker.js";
import { SERVICE_KEYS } from "./core/container.js";
import Database from "better-sqlite3";
import { ProxyAgentFactory } from "./proxy/transport/proxy-agent.js";
import { ProxyConnectivityChecker } from "./proxy/transport/provider-connectivity.js";
import { PluginRegistry } from "./proxy/transform/plugin-registry.js";
import { RetryRuleMatcher } from "./proxy/orchestration/retry-rules.js";
import { loadModelDirectory } from "./config/model-context.js";

// --- Extracted app modules ---
import { createAppInstance } from "./app/create-app.js";
import { composeContainer } from "./app/compose-container.js";
import { registerAppHooks } from "./app/register-hooks.js";
import { registerRoutes } from "./app/register-routes.js";

const PROVIDER_DEFAULT_QUEUE_TIMEOUT_MS = 5000;
const PROVIDER_DEFAULT_MAX_QUEUE_SIZE = 100;

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
  semaphoreManager: SemaphoreManager,
  adaptiveController: AdaptiveController,
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
  app: import("fastify").FastifyInstance;
  db: Database.Database;
  usageWindowTracker: UsageWindowTracker;
  tracker: RequestTracker;
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

  // 加载外部模型目录（ai-model-directory），fallback 到硬编码白名单
  loadModelDirectory();

  // Step 1: 创建 Fastify 实例 + 全局 hooks
  const app = createAppInstance({ config, db, upgradeCheckerOptions: options?.upgradeCheckerOptions });

  // Step 2: 注册所有服务到容器
  const { container, logFileWriter, logsDir, isMemoryDb } = composeContainer(db, { config }, app);

  // 从容器解析服务
  const matcher = container.resolve<RetryRuleMatcher>(SERVICE_KEYS.matcher);
  const semaphoreManager = container.resolve<SemaphoreManager>(SERVICE_KEYS.semaphoreManager);
  const tracker = container.resolve<RequestTracker>(SERVICE_KEYS.tracker);
  const usageWindowTracker = container.resolve<UsageWindowTracker>(SERVICE_KEYS.usageWindowTracker);
  const adaptiveController = container.resolve<AdaptiveController>(SERVICE_KEYS.adaptiveController);
  const proxyAgentFactory = container.resolve<ProxyAgentFactory>(SERVICE_KEYS.proxyAgentFactory);
  const pluginRegistry = container.resolve<PluginRegistry>(SERVICE_KEYS.pluginRegistry);

  // Wire adaptive controller to tracker
  tracker.setAdaptiveStatusProvider(adaptiveController);
  // 绑定信号量释放回调：kill 时按 reqId 同步释放槽位（防 kill 不释放信号量）
  tracker.setReleaseSlotProvider((reqId) => semaphoreManager.releaseByReqId(reqId));

  // 从 DB 读取已有 provider 的并发配置，初始化信号量/adaptive/tracker 缓存
  initializeProviderState(db, semaphoreManager, adaptiveController, tracker);

  // Step 3: 注册 auth + proxy handlers + 构建 StateRegistry
  const { stateRegistry } = registerAppHooks(app, db, container, {
    matcher,
    semaphoreManager,
    adaptiveController,
  });

  // Step 4: 注册 admin routes + 静态文件 + 定时任务 + close 函数
  const connectivityChecker = new ProxyConnectivityChecker();
  const close = registerRoutes(app, {
    db,
    config,
    container,
    tracker,
    semaphoreManager,
    adaptiveController,
    stateRegistry,
    logFileWriter,
    logsDir,
    isMemoryDb,
    pluginRegistry,
    proxyAgentFactory,
    connectivityChecker,
    initializeProviderStateFn: () => initializeProviderState(db, semaphoreManager, adaptiveController, tracker),
  });

  return {
    app,
    db,
    usageWindowTracker,
    tracker,
    close,
  };
}


export async function main() {
  // 启动期一次性 WARN：DEV_SKIP_AUTH=1 跳过 admin token 校验（仅 loopback 放行）
  if (process.env.DEV_SKIP_AUTH === "1") {
    console.warn(
      "\n⚠️  [SECURITY] DEV_SKIP_AUTH=1 — admin API is unauthenticated for loopback requests.\n" +
        "    Do NOT use in production. Setup flow is unchanged — password still required.\n",
    );
  }
  const { app, close } = await buildApp();
  const config = getConfig();

  // 全局兜底：防止未捕获异常导致进程崩溃
  process.on("uncaughtException", (err) => {
    const code = (err as NodeJS.ErrnoException).code;
    // EPIPE/ECONNRESET 是客户端断连后的正常网络错误，不影响服务稳定性
    if (code === "EPIPE" || code === "ECONNRESET") {
      try {
        app.log.warn({ err }, "Client disconnected (EPIPE/ECONNRESET)");
      } catch {
        console.warn("Client disconnected:", (err as Error).message);
      }
      return;
    }
    try {
      app.log.fatal({ err }, "Uncaught exception");
    /* eslint-disable taste/no-silent-catch -- app.log 可能已崩溃，console 是最后手段 */
    } catch {
      console.error("FATAL: Uncaught exception:", err);
    }
    /* eslint-enable taste/no-silent-catch */
    close().finally(() => process.exit(1));
  });

  process.on("unhandledRejection", (reason) => {
    try {
      app.log.error({ err: reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : JSON.stringify(reason)) }, "Unhandled rejection");
    /* eslint-disable taste/no-silent-catch -- app.log 可能已崩溃，console 是最后手段 */
    } catch {
      console.error("Unhandled rejection:", reason);
    }
    /* eslint-enable taste/no-silent-catch */
  });

  // 优雅关闭：SIGTERM 和 SIGINT（Ctrl+C）
  // 首次 = 优雅关闭，再次 = 强制退出
  let isShuttingDown = false;
  const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 10_000;

  const shutdown = async (signal: string) => {
    // 第二次收到信号 = 强制退出（Ctrl+C 卡住时用户可再按一次）
    if (isShuttingDown) {
      app.log.warn(`Received ${signal} again, forcing exit`);
      process.exit(1);
      return;
    }
    isShuttingDown = true;

    // 强制退出兜底：优雅关闭超过 N 秒则强制退出
    const forceTimer = setTimeout(() => {
      app.log.error("Graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
    // 不阻止进程退出
    forceTimer.unref();

    try {
      app.log.info(`Received ${signal}, shutting down gracefully...`);
      await close();
      app.log.info("Shutdown complete");
    } catch (err) {
      app.log.error({ err }, "Error during shutdown");
    }
    clearTimeout(forceTimer);
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

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

import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type Database from "better-sqlite3";
import { ServiceContainer, SERVICE_KEYS } from "../core/container.js";
import { HTTP_NOT_FOUND } from "../core/constants.js";
import { adminRoutes } from "../admin/routes.js";
import { RequestTracker } from "../core/monitor/index.js";
import { AdaptiveController } from "../core/concurrency/index.js";
import { SemaphoreManager } from "../core/concurrency/index.js";
import { scheduleLogCleanup } from "../db/log-cleaner.js";
import { scheduleDbSizeMonitor } from "../db/db-size-monitor.js";
import { scheduleMetricsAggregator } from "../db/metrics-aggregator.js";
import { scheduleLogFileMaintenance } from "../storage/log-file-compressor.js";
import { stopUpgradeChecker } from "../admin/upgrade.js";
import { getLogFileRetentionDays } from "../db/settings.js";
import { LogFileWriter } from "../storage/log-file-writer.js";
import { SessionTracker } from "../core/loop-prevention/index.js";
import { ProxyAgentFactory } from "../proxy/transport/proxy-agent.js";
import { ProxyConnectivityChecker } from "../proxy/transport/provider-connectivity.js";
import { PluginRegistry } from "../proxy/transform/plugin-registry.js";
import type { StateRegistry } from "../core/registry.js";
import type { Config } from "../config/index.js";

export interface RegisterRoutesOptions {
  db: Database.Database;
  config: Config;
  container: ServiceContainer;
  tracker: RequestTracker;
  semaphoreManager: SemaphoreManager;
  adaptiveController: AdaptiveController;
  stateRegistry: StateRegistry;
  logFileWriter: LogFileWriter | null;
  logsDir: string;
  isMemoryDb: boolean;
  pluginRegistry: PluginRegistry;
  proxyAgentFactory: ProxyAgentFactory;
  connectivityChecker: ProxyConnectivityChecker;
  // 初始化 provider 状态的回调（StateRegistry.reinitializeProviders 需要）
  initializeProviderStateFn: () => void;
}

/**
 * 注册 admin routes、静态文件、/health 端点、定时任务，组装 close 函数。
 * 返回 close 函数供 buildApp 消费。
 */
export function registerRoutes(
  app: FastifyInstance,
  opts: RegisterRoutesOptions,
): () => Promise<void> {
  const {
    db,
    config,
    container,
    tracker,
    semaphoreManager,
    logFileWriter,
    logsDir,
    isMemoryDb,
    proxyAgentFactory,
    stateRegistry,
    pluginRegistry,
    connectivityChecker,
  } = opts;

  // Override reinitializeProviders to use the full implementation
  const fullStateRegistry: StateRegistry = {
    ...stateRegistry,
    reinitializeProviders: () => {
      stateRegistry.reinitializeProviders();
      opts.initializeProviderStateFn();
    },
  };

  // Late-bound close ref — close 函数在 adminRoutes 注册之后才定义
  const closeRef = { fn: async () => {} };

  app.register(adminRoutes, {
    db,
    stateRegistry: fullStateRegistry,
    tracker,
    adaptiveController: opts.adaptiveController,
    logFileWriter,
    logsDir,
    closeFn: () => closeRef.fn(),
    pluginRegistry,
    proxyAgentFactory,
    connectivityChecker,
  });

  // 前端静态文件服务（生产环境）
  const __filename = fileURLToPath(import.meta.url);
  const frontendDist = path.resolve(
    process.env.FRONTEND_DIST || path.join(path.dirname(__filename), "../../frontend-dist"),
  );

  if (existsSync(frontendDist)) {
    app.register(fastifyStatic, {
      root: frontendDist,
      prefix: "/admin/",
      wildcard: false,
    });

    // SPA fallback
    app.setNotFoundHandler((request, reply) => {
      if (
        (request.url.startsWith("/admin/") || request.url === "/admin") &&
        !request.url.startsWith("/admin/api")
      ) {
        return reply.sendFile("index.html");
      }
      reply.code(HTTP_NOT_FOUND).send({ error: { message: "Not Found" } });
    });
  } else {
    app.log.debug(`Frontend dist not found at ${frontendDist}, skipping static serving`);
  }

  app.get("/health", async () => {
    return { status: "ok" };
  });

  const logCleanup = scheduleLogCleanup(db, app.log);
  const metricsAggregator = scheduleMetricsAggregator(db, app.log);
  const dbSizeMonitor = scheduleDbSizeMonitor(db, config.DB_PATH, { log: app.log });

  let closed = false;
  let close = async () => {
    if (closed) return;
    closed = true;
    stopUpgradeChecker();
    logCleanup.stop();
    metricsAggregator.stop();
    dbSizeMonitor.stop();
    tracker.stopPushInterval();
    tracker.closeAllClients();
    semaphoreManager.removeAll();
    proxyAgentFactory.invalidateAll();
    const sessionTracker = container.resolve<SessionTracker>(SERVICE_KEYS.sessionTracker);
    sessionTracker.stop();
    await logFileWriter?.stop();
    const CLOSE_GRACE_PERIOD_MS = 2_000;
    const forceClose = typeof app.server.closeAllConnections === "function"
      ? setTimeout(() => app.server.closeAllConnections!(), CLOSE_GRACE_PERIOD_MS)
      : null;
    if (forceClose) forceClose.unref();
    await app.close();
    if (forceClose) clearTimeout(forceClose);
    db.close();
  };

  // 文件压缩和清理任务（仅非 :memory: 模式）
  if (!isMemoryDb) {
    const logFileMaintenance = scheduleLogFileMaintenance(logsDir, {
      retentionDays: getLogFileRetentionDays(db),
      log: app.log,
    });
    const prevClose = close;
    close = async () => {
      logFileMaintenance.stop();
      await prevClose();
    };
  }

  // 绑定到 late-bound ref（供 restart API 运行时调用）
  closeRef.fn = close;

  return close;
}

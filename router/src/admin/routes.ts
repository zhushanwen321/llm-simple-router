import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { adminAuthPlugin, adminLoginRoutes } from "../middleware/admin-auth.js";
import { adminProviderRoutes } from "./providers.js";
import { adminMappingRoutes } from "./mappings.js";
import { adminGroupRoutes } from "./groups.js";
import { adminRetryRuleRoutes } from "./retry-rules.js";
import { adminLogRoutes } from "./logs.js";
import { adminStatsRoutes } from "./stats.js";
import { adminMetricsRoutes } from "./metrics.js";
import { adminProxyEnhancementRoutes } from "./proxy-enhancement.js";
import { adminRouterKeyRoutes } from "./router-keys.js";
import { adminSetupRoutes } from "./setup.js";
import { adminMonitorRoutes } from "./monitor.js";
import { adminSettingsRoutes } from "./settings.js";
import { adminRecommendedRoutes } from "./recommended.js";
import { adminUsageRoutes } from "./usage.js";
import { adminUpgradeRoutes } from "./upgrade.js";
import { adminQuickSetupRoutes } from "./quick-setup.js";
import { adminImportExportRoutes } from "./settings-import-export.js";
import { adminTransformRuleRoutes } from "./transform-rules.js";
import { adminScheduleRoutes } from "./schedules.js";
import { hookRegistry } from "../proxy/pipeline/hook-registry.js";
import type { StateRegistry } from "../core/registry.js";
import type { RequestTracker } from "@llm-router/core/monitor";
import type { AdaptiveController } from "@llm-router/core/concurrency";
import type { ProxyAgentFactory } from "../proxy/transport/proxy-agent.js";

interface AdminRoutesOptions {
  db: Database.Database;
  stateRegistry: StateRegistry;
  tracker?: RequestTracker;
  adaptiveController?: AdaptiveController;
  logFileWriter?: import("../storage/log-file-writer.js").LogFileWriter | null;
  logsDir?: string;
  pluginRegistry?: import("../proxy/transform/plugin-registry.js").PluginRegistry;
  closeFn?: () => Promise<void>;
  proxyAgentFactory?: ProxyAgentFactory;
}

export const adminRoutes: FastifyPluginCallback<AdminRoutesOptions> = (app, options, done) => {
  // Setup 路由不需要 auth
  app.register(adminSetupRoutes, { db: options.db });
  app.register(adminAuthPlugin, { db: options.db });
  app.register(adminLoginRoutes, { db: options.db });
  app.register(adminProviderRoutes, { db: options.db, stateRegistry: options.stateRegistry, tracker: options.tracker, adaptiveController: options.adaptiveController, proxyAgentFactory: options.proxyAgentFactory });
  app.register(adminMappingRoutes, { db: options.db });
  app.register(adminGroupRoutes, { db: options.db });
  app.register(adminScheduleRoutes, { db: options.db });
  app.register(adminRetryRuleRoutes, { db: options.db, stateRegistry: options.stateRegistry });
  app.register(adminLogRoutes, { db: options.db, logFileWriter: options.logFileWriter });
  app.register(adminRouterKeyRoutes, { db: options.db });
  app.register(adminStatsRoutes, { db: options.db });
  app.register(adminMetricsRoutes, { db: options.db });
  app.register(adminProxyEnhancementRoutes, { db: options.db });
  app.register(adminMonitorRoutes, { tracker: options.tracker });
  app.register(adminSettingsRoutes, { db: options.db, logsDir: options.logsDir });
  app.register(adminImportExportRoutes, { db: options.db, stateRegistry: options.stateRegistry, pluginRegistry: options.pluginRegistry });
  app.register(adminRecommendedRoutes, { db: options.db });
  app.register(adminUsageRoutes, { db: options.db });
  app.register(adminQuickSetupRoutes, { db: options.db, stateRegistry: options.stateRegistry, tracker: options.tracker, adaptiveController: options.adaptiveController });
  app.register(adminUpgradeRoutes, { db: options.db, closeFn: options.closeFn ?? (async () => {}) });
  app.register(adminTransformRuleRoutes, { db: options.db, pluginRegistry: options.pluginRegistry });

  // Pipeline hooks 查询
  app.get("/admin/api/pipeline/hooks", async () => {
    return { hooks: hookRegistry.getAll() };
  });

  done();
};

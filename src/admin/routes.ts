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
import { adminImportExportRoutes } from "./settings-import-export.js";
import { adminScheduleRoutes } from "./schedules.js";
import type { StateRegistry } from "../core/registry.js";
import type { RequestTracker } from "../monitor/request-tracker.js";
import type { AdaptiveConcurrencyController } from "../proxy/adaptive-controller.js";

interface AdminRoutesOptions {
  db: Database.Database;
  stateRegistry: StateRegistry;
  tracker?: RequestTracker;
  adaptiveController?: AdaptiveConcurrencyController;
}

export const adminRoutes: FastifyPluginCallback<AdminRoutesOptions> = (app, options, done) => {
  // Setup 路由不需要 auth
  app.register(adminSetupRoutes, { db: options.db });
  app.register(adminAuthPlugin, { db: options.db });
  app.register(adminLoginRoutes, { db: options.db });
  app.register(adminProviderRoutes, { db: options.db, stateRegistry: options.stateRegistry, tracker: options.tracker, adaptiveController: options.adaptiveController });
  app.register(adminMappingRoutes, { db: options.db });
  app.register(adminGroupRoutes, { db: options.db });
  app.register(adminScheduleRoutes, { db: options.db });
  app.register(adminRetryRuleRoutes, { db: options.db, stateRegistry: options.stateRegistry });
  app.register(adminLogRoutes, { db: options.db });
  app.register(adminRouterKeyRoutes, { db: options.db });
  app.register(adminStatsRoutes, { db: options.db });
  app.register(adminMetricsRoutes, { db: options.db });
  app.register(adminProxyEnhancementRoutes, { db: options.db, stateRegistry: options.stateRegistry });
  app.register(adminMonitorRoutes, { tracker: options.tracker });
  app.register(adminSettingsRoutes, { db: options.db });
  app.register(adminImportExportRoutes, { db: options.db, stateRegistry: options.stateRegistry });
  app.register(adminRecommendedRoutes, { db: options.db });
  app.register(adminUsageRoutes, { db: options.db });
  app.register(adminUpgradeRoutes, { db: options.db });
  done();
};

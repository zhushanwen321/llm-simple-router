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
import { RetryRuleMatcher } from "../proxy/retry-rules.js";

interface AdminRoutesOptions {
  db: Database.Database;
  matcher: RetryRuleMatcher | null;
}

export const adminRoutes: FastifyPluginCallback<AdminRoutesOptions> = (app, options, done) => {
  // Setup 路由不需要 auth
  app.register(adminSetupRoutes, { db: options.db });
  app.register(adminAuthPlugin, { db: options.db });
  app.register(adminLoginRoutes, { db: options.db });
  app.register(adminProviderRoutes, { db: options.db });
  app.register(adminMappingRoutes, { db: options.db });
  app.register(adminGroupRoutes, { db: options.db });
  app.register(adminRetryRuleRoutes, { db: options.db, matcher: options.matcher });
  app.register(adminLogRoutes, { db: options.db });
  app.register(adminRouterKeyRoutes, { db: options.db });
  app.register(adminStatsRoutes, { db: options.db });
  app.register(adminMetricsRoutes, { db: options.db });
  app.register(adminProxyEnhancementRoutes, { db: options.db });
  done();
};

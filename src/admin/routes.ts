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
import { adminRouterKeyRoutes } from "./router-keys.js";
import { RetryRuleMatcher } from "../proxy/retry-rules.js";

interface AdminRoutesOptions {
  db: Database.Database;
  adminPassword: string;
  jwtSecret: string;
  encryptionKey: string;
  matcher: RetryRuleMatcher | null;
}

export const adminRoutes: FastifyPluginCallback<AdminRoutesOptions> = (app, options, done) => {
  app.register(adminAuthPlugin, { adminPassword: options.adminPassword, jwtSecret: options.jwtSecret });
  app.register(adminLoginRoutes, { adminPassword: options.adminPassword, jwtSecret: options.jwtSecret });
  app.register(adminProviderRoutes, { db: options.db, encryptionKey: options.encryptionKey });
  app.register(adminMappingRoutes, { db: options.db });
  app.register(adminGroupRoutes, { db: options.db });
  app.register(adminRetryRuleRoutes, { db: options.db, matcher: options.matcher });
  app.register(adminLogRoutes, { db: options.db });
  app.register(adminRouterKeyRoutes, { db: options.db, encryptionKey: options.encryptionKey });
  app.register(adminStatsRoutes, { db: options.db });
  app.register(adminMetricsRoutes, { db: options.db });
  done();
};

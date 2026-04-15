import { FastifyPluginCallback } from "fastify";
import { adminAuthPlugin, adminLoginRoutes } from "../middleware/admin-auth.js";
import { adminProviderRoutes } from "./providers.js";
import { adminMappingRoutes } from "./mappings.js";
import { adminLogRoutes } from "./logs.js";
import { adminStatsRoutes } from "./stats.js";

interface AdminRoutesOptions {
  db: any;
  adminPassword: string;
  encryptionKey: string;
}

export const adminRoutes: FastifyPluginCallback<AdminRoutesOptions> = (app, options, done) => {
  app.register(adminAuthPlugin, { adminPassword: options.adminPassword });
  app.register(adminLoginRoutes, { adminPassword: options.adminPassword });
  app.register(adminProviderRoutes, { db: options.db, encryptionKey: options.encryptionKey });
  app.register(adminMappingRoutes, { db: options.db });
  app.register(adminLogRoutes, { db: options.db });
  app.register(adminStatsRoutes, { db: options.db });
  done();
};

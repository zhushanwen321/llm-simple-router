import { FastifyPluginCallback } from "fastify";
import { adminAuthPlugin, adminLoginRoutes } from "../middleware/admin-auth.js";
import { adminServiceRoutes } from "./services.js";

interface AdminRoutesOptions {
  db: any;
  adminPassword: string;
  encryptionKey: string;
}

export const adminRoutes: FastifyPluginCallback<AdminRoutesOptions> = (app, options, done) => {
  app.register(adminAuthPlugin, { adminPassword: options.adminPassword });
  app.register(adminLoginRoutes, { adminPassword: options.adminPassword });
  app.register(adminServiceRoutes, { db: options.db, encryptionKey: options.encryptionKey });
  done();
};

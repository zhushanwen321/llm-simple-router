import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { getLogRetentionDays, setLogRetentionDays } from "../db/settings.js";

interface SettingsOptions {
  db: Database.Database;
}

export const adminSettingsRoutes: FastifyPluginCallback<SettingsOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/settings/log-retention", async () => {
    return { days: getLogRetentionDays(db) };
  });

  app.put("/admin/api/settings/log-retention", async (request) => {
    const { days } = request.body as { days: number };
    const MAX_LOG_RETENTION_DAYS = 90;
    if (!Number.isInteger(days) || days < 0 || days > MAX_LOG_RETENTION_DAYS) {
      throw { statusCode: 400, message: "days must be integer 0-90" };
    }
    setLogRetentionDays(db, days);
    return { days };
  });

  done();
};

import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import {
  getLogRetentionDays, setLogRetentionDays,
  getDbMaxSizeMb, setDbMaxSizeMb,
  getLogTableMaxSizeMb, setLogTableMaxSizeMb,
  getSetting,
} from "../db/settings.js";

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

  app.get("/admin/api/settings/db-size", async () => {
    const raw = getSetting(db, "db_size_info");
    const sizeInfo = raw ? JSON.parse(raw) : { totalBytes: 0, logTableBytes: 0, logCount: 0, lastChecked: null };
    return {
      ...sizeInfo,
      thresholds: {
        dbMaxSizeMb: getDbMaxSizeMb(db),
        logTableMaxSizeMb: getLogTableMaxSizeMb(db),
      },
    };
  });

  app.put("/admin/api/settings/db-size-thresholds", async (request) => {
    const body = request.body as { dbMaxSizeMb?: number; logTableMaxSizeMb?: number };
    if (body.dbMaxSizeMb !== undefined) {
      if (!Number.isFinite(body.dbMaxSizeMb) || body.dbMaxSizeMb < 1) {
        throw { statusCode: 400, message: "dbMaxSizeMb must be a positive number" };
      }
      setDbMaxSizeMb(db, Math.round(body.dbMaxSizeMb));
    }
    if (body.logTableMaxSizeMb !== undefined) {
      if (!Number.isFinite(body.logTableMaxSizeMb) || body.logTableMaxSizeMb < 1) {
        throw { statusCode: 400, message: "logTableMaxSizeMb must be a positive number" };
      }
      setLogTableMaxSizeMb(db, Math.round(body.logTableMaxSizeMb));
    }
    return {
      dbMaxSizeMb: getDbMaxSizeMb(db),
      logTableMaxSizeMb: getLogTableMaxSizeMb(db),
    };
  });

  done();
};

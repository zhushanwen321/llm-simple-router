import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import {
  getLogRetentionDays, setLogRetentionDays,
  getDbMaxSizeMb, setDbMaxSizeMb,
  getLogTableMaxSizeMb, setLogTableMaxSizeMb,
  getSetting,
} from "../db/settings.js";
import { HTTP_BAD_REQUEST } from "./constants.js";
import { API_CODE, apiError } from "./api-response.js";

interface SettingsOptions {
  db: Database.Database;
}

export const adminSettingsRoutes: FastifyPluginCallback<SettingsOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/settings/log-retention", async () => {
    return { days: getLogRetentionDays(db) };
  });

  app.put("/admin/api/settings/log-retention", async (request, reply) => {
    const { days } = request.body as { days: number };
    const MAX_LOG_RETENTION_DAYS = 90;
    if (!Number.isInteger(days) || days < 0 || days > MAX_LOG_RETENTION_DAYS) {
      return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, "days must be integer 0-90"));
    }
    setLogRetentionDays(db, days);
    return { days };
  });

  app.get("/admin/api/settings/db-size", async () => {
    const DEFAULT_SIZE_INFO = { totalBytes: 0, logTableBytes: 0, logCount: 0, lastChecked: null };
    const raw = getSetting(db, "db_size_info");
    let sizeInfo = DEFAULT_SIZE_INFO;
    if (raw) {
      try { sizeInfo = JSON.parse(raw); } catch { /* eslint-disable-line taste/no-silent-catch -- 损坏的缓存值，回退默认 */ }
    }
    return {
      ...sizeInfo,
      thresholds: {
        dbMaxSizeMb: getDbMaxSizeMb(db),
        logTableMaxSizeMb: getLogTableMaxSizeMb(db),
      },
    };
  });

  app.put("/admin/api/settings/db-size-thresholds", async (request, reply) => {
    const body = request.body as { dbMaxSizeMb?: number; logTableMaxSizeMb?: number };
    if (body.dbMaxSizeMb !== undefined) {
      if (!Number.isFinite(body.dbMaxSizeMb) || body.dbMaxSizeMb < 1) {
        return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, "dbMaxSizeMb must be a positive number"));
      }
      setDbMaxSizeMb(db, Math.round(body.dbMaxSizeMb));
    }
    if (body.logTableMaxSizeMb !== undefined) {
      if (!Number.isFinite(body.logTableMaxSizeMb) || body.logTableMaxSizeMb < 1) {
        return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, "logTableMaxSizeMb must be a positive number"));
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

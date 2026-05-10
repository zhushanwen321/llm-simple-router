import { statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import {
  getLogRetentionDays, setLogRetentionDays,
  getDbMaxSizeMb, setDbMaxSizeMb,
  getLogTableMaxSizeMb, setLogTableMaxSizeMb,
  getSetting, getTokenEstimationEnabled, setTokenEstimationEnabled,
  getClientSessionHeaders, setClientSessionHeaders,
} from "../db/settings.js";
import { HTTP_BAD_REQUEST } from "./constants.js";
import { API_CODE, apiError } from "./api-response.js";

interface SettingsOptions {
  db: Database.Database;
  logsDir?: string;
}

export const adminSettingsRoutes: FastifyPluginCallback<SettingsOptions> = (app, options, done) => {
  const { db, logsDir } = options;

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
    // 计算日志文件目录大小
    let logFileBytes = 0;
    if (logsDir) {
      try {
        logFileBytes = calcDirSize(logsDir);
      } catch { /* eslint-disable-line taste/no-silent-catch -- 目录可能不存在 */ }
    }

    return {
      ...sizeInfo,
      logFileBytes,
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

  app.get("/admin/api/settings/token-estimation", async () => {
    return { enabled: getTokenEstimationEnabled(db) };
  });

  app.put("/admin/api/settings/token-estimation", async (request, reply) => {
    const { enabled } = request.body as { enabled: boolean };
    if (typeof enabled !== "boolean") {
      return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, "enabled must be a boolean"));
    }
    setTokenEstimationEnabled(db, enabled);
    return { success: true };
  });

  app.get("/admin/api/settings/client-session-headers", async () => {
    const entries = getClientSessionHeaders(db);
    return { entries };
  });

  app.put("/admin/api/settings/client-session-headers", async (request, reply) => {
    const body = request.body as { entries?: unknown };
    if (!Array.isArray(body.entries)) {
      return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, "entries must be a non-empty array"));
    }
    const entries = body.entries as Array<{ client_type?: string; session_header_key?: string }>;
    if (entries.length === 0) {
      return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, "entries must be a non-empty array"));
    }
    for (const entry of entries) {
      if (!entry.client_type || typeof entry.client_type !== "string" || entry.client_type.trim() === "") {
        return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, "each entry must have a non-empty client_type"));
      }
      if (!entry.session_header_key || typeof entry.session_header_key !== "string" || entry.session_header_key.trim() === "") {
        return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, "each entry must have a non-empty session_header_key"));
      }
    }
    setClientSessionHeaders(db, entries as Array<{ client_type: string; session_header_key: string }>);
    return { success: true };
  });

  done();
};

/** 递归计算目录下所有文件的总大小（字节） */
function calcDirSize(dirPath: string): number {
  let total = 0;
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += calcDirSize(fullPath);
    } else if (entry.isFile()) {
      try { total += statSync(fullPath).size; } catch { /* 文件可能刚被删除 */ } // eslint-disable-line taste/no-silent-catch
    }
  }
  return total;
}

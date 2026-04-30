import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { createHash } from "crypto";
import type { StateRegistry } from "../core/registry.js";
import { encrypt, decrypt } from "../utils/crypto.js";
import { getSetting } from "../db/settings.js";
import { API_CODE, apiError } from "./api-response.js";

interface ImportExportOptions {
  db: Database.Database;
  stateRegistry: StateRegistry;
}

const CONFIG_TABLES = [
  "providers",
  "mapping_groups",
  "retry_rules",
  "router_keys",
  "settings",
  "session_model_states",
  "schedules",
  "provider_model_info",
  "session_model_history",
];

// settings 表按 key 列的值过滤，不覆盖本地安全敏感配置
const PROTECTED_SETTING_KEYS = new Set(["admin_password_hash", "jwt_secret", "encryption_key"]);

const EXPORT_VERSION = 1;

const ISO_DATE_LENGTH = 10;
const BAD_REQUEST = 400;
const KEY_PREFIX_LENGTH = 8;

export const adminImportExportRoutes: FastifyPluginCallback<ImportExportOptions> = (app, options, done) => {
  const { db, stateRegistry } = options;

  app.get("/admin/api/settings/export", async (_request, reply) => {
    const encryptionKey = getSetting(db, "encryption_key");
    const data: Record<string, unknown[]> = {};
    for (const table of CONFIG_TABLES) {
      data[table] = db.prepare(`SELECT * FROM ${table}`).all();
    }

    // 导出时解密敏感字段，确保跨实例可移植
    if (encryptionKey) {
      for (const row of (data.providers || []) as Record<string, unknown>[]) {
        if (typeof row.api_key === "string" && row.api_key) {
          try { row.api_key = decrypt(row.api_key, encryptionKey); } catch { /* eslint-disable-line taste/no-silent-catch -- 无法解密则保留原值 */ }
        }
      }
      for (const row of (data.router_keys || []) as Record<string, unknown>[]) {
        if (typeof row.key_encrypted === "string") {
          try {
            row.key = decrypt(row.key_encrypted, encryptionKey);
            delete row.key_encrypted;
            delete row.key_hash;
            delete row.key_prefix;
          } catch { /* eslint-disable-line taste/no-silent-catch -- 无法解密则保留加密数据 */ }
        }
      }
    }

    const date = new Date().toISOString().slice(0, ISO_DATE_LENGTH);
    reply.header("Content-Disposition", `attachment; filename="router-config-${date}.json"`);

    return reply.send({
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      data,
    });
  });

  app.post("/admin/api/settings/import", async (request, reply) => {
    const body = request.body as { version?: number; data?: Record<string, unknown[]> };
    if (typeof body.version !== "number" || body.version !== EXPORT_VERSION) {
      return reply.code(BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, `Unsupported version. Expected ${EXPORT_VERSION}.`));
    }
    if (!body.data || typeof body.data !== "object") {
      return reply.code(BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, "Missing or invalid data field"));
    }

    const counts: Record<string, number> = {};
    const importData = body.data;
    const encryptionKey = getSetting(db, "encryption_key");

    // 导入时用本地密钥重新加密敏感字段
    if (encryptionKey) {
      for (const row of (importData.providers || []) as Record<string, unknown>[]) {
        if (typeof row.api_key === "string" && row.api_key) {
          row.api_key = encrypt(row.api_key, encryptionKey);
        }
      }
      for (const row of (importData.router_keys || []) as Record<string, unknown>[]) {
        if (typeof row.key === "string") {
          row.key_hash = createHash("sha256").update(row.key).digest("hex");
          row.key_prefix = row.key.slice(0, KEY_PREFIX_LENGTH);
          row.key_encrypted = encrypt(row.key, encryptionKey);
          delete row.key;
        }
      }
    }

    db.transaction(() => {
      // 临时关闭外键检查，避免删除顺序导致约束冲突
      const prevFk = db.pragma("foreign_keys", { simple: true });
      db.pragma("foreign_keys = OFF");

      // 导入前先备份受保护配置，导入后恢复
      const protectedRows = db
        .prepare(`SELECT * FROM settings WHERE key IN (${[...PROTECTED_SETTING_KEYS].map(() => "?").join(", ")})`)
        .all(...PROTECTED_SETTING_KEYS) as Record<string, unknown>[];

      for (const table of CONFIG_TABLES) {
        const rows = importData[table];
        if (!Array.isArray(rows)) continue;

        db.exec(`DELETE FROM ${table}`);

        // 用 PRAGMA table_info 获取合法列名，防止用户 JSON 注入非法列
        const validCols = new Set(
          (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
        );

        for (const row of rows) {
          const entries = Object.entries(row as Record<string, unknown>).filter(([k]) => validCols.has(k));
          if (entries.length === 0) continue;

          if (table === "settings") {
            const keyValue = entries.find(([k]) => k === "key")?.[1] as string | undefined;
            if (keyValue && PROTECTED_SETTING_KEYS.has(keyValue)) {
              continue;
            }
          }
          const cols = entries.map(([k]) => k).join(", ");
          const vals = entries.map(() => "?").join(", ");
          db.prepare(`INSERT INTO ${table} (${cols}) VALUES (${vals})`).run(...entries.map(([, v]) => v));
        }
        counts[table] = rows.length;
      }

      // 恢复受保护配置
      const upsertStmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
      for (const row of protectedRows) {
        upsertStmt.run(row.key, row.value);
      }

      // 恢复外键设置
      db.pragma(`foreign_keys = ${prevFk}`);
    })();

    // 导入成功后刷新内存缓存
    stateRegistry.refreshRetryRules();

    // 清除旧的 semaphore/adaptive/tracker 配置，按导入后的 DB 数据全量重建
    stateRegistry.removeAllProviders();
    stateRegistry.clearModelState();
    stateRegistry.reinitializeProviders();

    return reply.send(counts);
  });

  done();
};

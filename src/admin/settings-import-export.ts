import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";

interface ImportExportOptions {
  db: Database.Database;
}

const CONFIG_TABLES = [
  "providers",
  "mapping_groups",
  "retry_rules",
  "router_keys",
  "settings",
  "session_model_states",
];

// settings 表按 key 列的值过滤，不覆盖本地安全敏感配置
const PROTECTED_SETTING_KEYS = new Set(["admin_password_hash", "jwt_secret"]);

const EXPORT_VERSION = 1;

const ISO_DATE_LENGTH = 10;
const BAD_REQUEST = 400;

export const adminImportExportRoutes: FastifyPluginCallback<ImportExportOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/settings/export", async (_request, reply) => {
    const data: Record<string, unknown[]> = {};
    for (const table of CONFIG_TABLES) {
      data[table] = db.prepare(`SELECT * FROM ${table}`).all();
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
    if (!body.version || body.version !== EXPORT_VERSION) {
      return reply.code(BAD_REQUEST).send({ error: { message: `Unsupported version. Expected ${EXPORT_VERSION}.` } });
    }
    if (!body.data) {
      return reply.code(BAD_REQUEST).send({ error: { message: "Missing data field" } });
    }

    const counts: Record<string, number> = {};
    const importData = body.data;

    db.transaction(() => {
      // 临时关闭外键检查，避免删除顺序导致约束冲突
      const prevFk = db.pragma("foreign_keys", { simple: true });
      db.pragma("foreign_keys = OFF");

      // 导入前先备份受保护配置，导入后恢复
      const protectedRows = db
        .prepare("SELECT * FROM settings WHERE key IN (?, ?)")
        .all(...PROTECTED_SETTING_KEYS) as Record<string, unknown>[];

      for (const table of CONFIG_TABLES) {
        const rows = importData[table];
        if (!Array.isArray(rows)) continue;

        db.exec(`DELETE FROM ${table}`);

        for (const row of rows) {
          const entries = Object.entries(row as Record<string, unknown>);
          if (table === "settings") {
            // 跳过受保护配置（用本地值恢复）
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

    return reply.send(counts);
  });

  done();
};

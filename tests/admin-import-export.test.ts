import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { hashPassword } from "../src/utils/password.js";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function makeConfig() {
  return {
    PORT: 9981,
    DB_PATH: ":memory:",
    LOG_LEVEL: "silent",
    TZ: "Asia/Shanghai",
    STREAM_TIMEOUT_MS: 5000,
    RETRY_MAX_ATTEMPTS: 0,
    RETRY_BASE_DELAY_MS: 0,
  };
}

async function login(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/login",
    payload: { password: "test-admin-pass" },
  });
  const match = (res.headers["set-cookie"] as string).match(/admin_token=([^;]+)/);
  return `admin_token=${match![1]}`;
}

function seedSettings(db: ReturnType<typeof initDatabase>) {
  setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
  setSetting(db, "jwt_secret", "test-jwt-secret-for-testing");
  setSetting(db, "admin_password_hash", hashPassword("test-admin-pass"));
  setSetting(db, "initialized", "true");
  setSetting(db, "log_retention_days", "3");
}

describe("Config Import/Export API", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof initDatabase>;
  let close: () => Promise<void>;
  let cookie: string;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    seedSettings(db);
    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);
  });

  afterEach(async () => {
    await close();
  });

  describe("GET /admin/api/settings/export", () => {
    it("returns valid JSON export with version field", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/api/settings/export",
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-disposition"]).toContain("router-config-");
      const body = res.json();
      expect(body.version).toBe(1);
      expect(body.exportedAt).toBeTruthy();
      expect(body.data).toHaveProperty("providers");
      expect(body.data).toHaveProperty("settings");
    });

    it("does not export request_logs or request_metrics", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/api/settings/export",
        headers: { cookie },
      });
      const body = res.json();
      expect(body.data).not.toHaveProperty("request_logs");
      expect(body.data).not.toHaveProperty("request_metrics");
    });
  });

  describe("POST /admin/api/settings/import", () => {
    it("imports config and returns counts", async () => {
      const exportRes = await app.inject({
        method: "GET",
        url: "/admin/api/settings/export",
        headers: { cookie },
      });
      const exportData = exportRes.json();

      const importRes = await app.inject({
        method: "POST",
        url: "/admin/api/settings/import",
        payload: exportData,
        headers: { cookie, "content-type": "application/json" },
      });
      expect(importRes.statusCode).toBe(200);
      const result = importRes.json();
      expect(result).toHaveProperty("providers");
      expect(result).toHaveProperty("settings");
    });

    it("rejects missing version", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/settings/import",
        payload: { data: {} },
        headers: { cookie, "content-type": "application/json" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects wrong version", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/settings/import",
        payload: { version: 99, data: {} },
        headers: { cookie, "content-type": "application/json" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects missing data field", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/settings/import",
        payload: { version: 1 },
        headers: { cookie, "content-type": "application/json" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("preserves local admin_password_hash and jwt_secret on import", async () => {
      const exportRes = await app.inject({
        method: "GET",
        url: "/admin/api/settings/export",
        headers: { cookie },
      });
      const exportData = exportRes.json();
      // 篡改导出数据中的密码和 JWT 密钥
      exportData.data.settings = exportData.data.settings.map((s: any) =>
        s.key === "admin_password_hash"
          ? { ...s, value: "tampered-password-hash" }
          : s.key === "jwt_secret"
            ? { ...s, value: "tampered-jwt" }
            : s,
      );

      await app.inject({
        method: "POST",
        url: "/admin/api/settings/import",
        payload: exportData,
        headers: { cookie, "content-type": "application/json" },
      });

      // 原密码仍然能登录
      const loginRes = await app.inject({
        method: "POST",
        url: "/admin/api/login",
        payload: { password: "test-admin-pass" },
      });
      expect(loginRes.statusCode).toBe(200);
    });

    it("preserves local log_retention_days value from export", async () => {
      const exportRes = await app.inject({
        method: "GET",
        url: "/admin/api/settings/export",
        headers: { cookie },
      });
      const exportData = exportRes.json();
      // 修改非受保护配置项
      exportData.data.settings = exportData.data.settings.map((s: any) =>
        s.key === "log_retention_days" ? { ...s, value: "7" } : s,
      );

      await app.inject({
        method: "POST",
        url: "/admin/api/settings/import",
        payload: exportData,
        headers: { cookie, "content-type": "application/json" },
      });

      // 再次导出验证值已更新
      const reExportRes = await app.inject({
        method: "GET",
        url: "/admin/api/settings/export",
        headers: { cookie },
      });
      const reExportData = reExportRes.json();
      const logRetention = reExportData.data.settings.find((s: any) => s.key === "log_retention_days");
      expect(logRetention.value).toBe("7");
    });
  });
});

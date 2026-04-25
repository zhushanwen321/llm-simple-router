import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { createHash } from "crypto";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { hashPassword } from "../src/utils/password.js";
import { encrypt, decrypt } from "../src/utils/crypto.js";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function makeConfig() {
  return {
    PORT: 9981,
    DB_PATH: ":memory:",
    LOG_LEVEL: "silent",
    TZ: "Asia/Shanghai",
    STREAM_TIMEOUT_MS: 5000,
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
      const body = res.json().data;
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
      const body = res.json().data;
      expect(body.data).not.toHaveProperty("request_logs");
      expect(body.data).not.toHaveProperty("request_metrics");
    });

    it("decrypts provider api_key to plaintext", async () => {
      const plainApiKey = "sk-test-plaintext-key-12345";
      const encryptedApiKey = encrypt(plainApiKey, TEST_ENCRYPTION_KEY);
      db.prepare(
        "INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("test-p-id", "Test Provider", "openai", "https://api.test.com", encryptedApiKey, 1, new Date().toISOString(), new Date().toISOString());

      const res = await app.inject({
        method: "GET",
        url: "/admin/api/settings/export",
        headers: { cookie },
      });
      const body = res.json().data;
      const provider = body.data.providers.find((p: any) => p.id === "test-p-id");
      expect(provider.api_key).toBe(plainApiKey);
    });

    it("decrypts router_keys and replaces key_encrypted with plaintext key", async () => {
      const plainKey = "sk-router-testkey1234567890abcdef";
      const keyEncrypted = encrypt(plainKey, TEST_ENCRYPTION_KEY);
      const keyHash = createHash("sha256").update(plainKey).digest("hex");
      const keyPrefix = plainKey.slice(0, 8);
      db.prepare(
        "INSERT INTO router_keys (id, name, key_hash, key_prefix, key_encrypted, is_active) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("test-rk-id", "Test Key", keyHash, keyPrefix, keyEncrypted, 1);

      const res = await app.inject({
        method: "GET",
        url: "/admin/api/settings/export",
        headers: { cookie },
      });
      const body = res.json().data;
      const rk = body.data.router_keys.find((k: any) => k.id === "test-rk-id");
      expect(rk.key).toBe(plainKey);
      expect(rk).not.toHaveProperty("key_encrypted");
      expect(rk).not.toHaveProperty("key_hash");
      expect(rk).not.toHaveProperty("key_prefix");
    });
  });

  describe("POST /admin/api/settings/import", () => {
    it("imports config and returns counts", async () => {
      const exportRes = await app.inject({
        method: "GET",
        url: "/admin/api/settings/export",
        headers: { cookie },
      });
      const exportData = exportRes.json().data;

      const importRes = await app.inject({
        method: "POST",
        url: "/admin/api/settings/import",
        payload: exportData,
        headers: { cookie, "content-type": "application/json" },
      });
      expect(importRes.statusCode).toBe(200);
      const result = importRes.json().data;
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
      const body = res.json()
      expect(body.code).toBe(40001)
      expect(body.data).toBeNull()
    });

    it("rejects wrong version", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/settings/import",
        payload: { version: 99, data: {} },
        headers: { cookie, "content-type": "application/json" },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json()
      expect(body.code).toBe(40001)
      expect(body.data).toBeNull()
    });

    it("rejects missing data field", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/settings/import",
        payload: { version: 1 },
        headers: { cookie, "content-type": "application/json" },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json()
      expect(body.code).toBe(40001)
      expect(body.data).toBeNull()
    });

    it("re-encrypts provider api_key with local key on import", async () => {
      const plainApiKey = "sk-import-test-key";
      const now = new Date().toISOString();
      const exportData = {
        version: 1,
        data: {
          providers: [{
            id: "import-p-id", name: "Import Provider", api_type: "openai",
            base_url: "https://api.test.com", api_key: plainApiKey,
            is_active: 1, created_at: now, updated_at: now,
          }],
        },
      };

      await app.inject({
        method: "POST",
        url: "/admin/api/settings/import",
        payload: exportData,
        headers: { cookie, "content-type": "application/json" },
      });

      const row = db.prepare("SELECT api_key FROM providers WHERE id = ?").get("import-p-id") as { api_key: string };
      expect(row.api_key).not.toBe(plainApiKey);
      expect(decrypt(row.api_key, TEST_ENCRYPTION_KEY)).toBe(plainApiKey);
    });

    it("re-encrypts router_key from plaintext key on import", async () => {
      const plainKey = "sk-router-import-key-abcdef";
      const now = new Date().toISOString();
      const exportData = {
        version: 1,
        data: {
          router_keys: [{
            id: "import-rk-id", name: "Import Key", key: plainKey, is_active: 1,
            allowed_models: null, created_at: now, updated_at: now,
          }],
        },
      };

      await app.inject({
        method: "POST",
        url: "/admin/api/settings/import",
        payload: exportData,
        headers: { cookie, "content-type": "application/json" },
      });

      const row = db.prepare("SELECT * FROM router_keys WHERE id = ?").get("import-rk-id") as Record<string, any>;
      expect(row.key_encrypted).toBeTruthy();
      expect(decrypt(row.key_encrypted, TEST_ENCRYPTION_KEY)).toBe(plainKey);
      expect(row.key_hash).toBe(createHash("sha256").update(plainKey).digest("hex"));
      expect(row.key_prefix).toBe(plainKey.slice(0, 8));
    });

    it("preserves local admin_password_hash and jwt_secret on import", async () => {
      const exportRes = await app.inject({
        method: "GET",
        url: "/admin/api/settings/export",
        headers: { cookie },
      });
      const exportData = exportRes.json().data;
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
      const exportData = exportRes.json().data;
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
      const reExportData = reExportRes.json().data;
      const logRetention = reExportData.data.settings.find((s: any) => s.key === "log_retention_days");
      expect(logRetention.value).toBe("7");
    });
  });
});

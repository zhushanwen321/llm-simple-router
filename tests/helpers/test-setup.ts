import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { setSetting } from "../../src/db/settings.js";
import { hashPassword } from "../../src/utils/password.js";

export const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

export function makeConfig() {
  return {
    PORT: 9981,
    DB_PATH: ":memory:",
    LOG_LEVEL: "silent" as const,
    TZ: "Asia/Shanghai",
    STREAM_TIMEOUT_MS: 5000,
    RETRY_BASE_DELAY_MS: 0,
  };
}

export function seedSettings(db: Database.Database) {
  setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
  setSetting(db, "jwt_secret", "test-jwt-secret-for-testing");
  setSetting(db, "admin_password_hash", hashPassword("test-admin-pass"));
  setSetting(db, "initialized", "true");
}

export async function login(
  app: FastifyInstance,
  password = "test-admin-pass"
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/login",
    payload: { password },
  });
  const match = (res.headers["set-cookie"] as string).match(
    /admin_token=([^;]+)/
  );
  return `admin_token=${match![1]}`;
}

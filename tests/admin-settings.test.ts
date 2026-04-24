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
}

describe("Admin Settings API", () => {
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

  it("GET /settings/log-retention returns default 3", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/settings/log-retention",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ days: 3 });
  });

  it("PUT /settings/log-retention updates value", async () => {
    const putRes = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/log-retention",
      payload: { days: 7 },
      headers: { cookie },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json()).toEqual({ days: 7 });

    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/settings/log-retention",
      headers: { cookie },
    });
    expect(getRes.json()).toEqual({ days: 7 });
  });

  it("PUT rejects invalid days (negative)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/log-retention",
      payload: { days: -1 },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT rejects invalid days (> 90)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/log-retention",
      payload: { days: 91 },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT accepts 0 (disable auto cleanup)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/log-retention",
      payload: { days: 0 },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ days: 0 });
  });

  it("GET /settings/db-size returns defaults", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/settings/db-size",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.thresholds.dbMaxSizeMb).toBe(1024);
    expect(body.thresholds.logTableMaxSizeMb).toBe(800);
  });

  it("PUT /settings/db-size-thresholds updates values", async () => {
    const putRes = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/db-size-thresholds",
      payload: { dbMaxSizeMb: 2048, logTableMaxSizeMb: 1600 },
      headers: { cookie },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json()).toEqual({ dbMaxSizeMb: 2048, logTableMaxSizeMb: 1600 });
  });

  it("PUT /settings/db-size-thresholds rejects invalid values", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/db-size-thresholds",
      payload: { dbMaxSizeMb: -1 },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});

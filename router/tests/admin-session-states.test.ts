import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { hashPassword } from "../src/utils/password.js";
import { upsertSessionState, insertSessionHistory } from "../src/db/session-states.js";

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
  const setCookie = res.headers["set-cookie"];
  expect(setCookie).toBeDefined();
  const match = (setCookie as string).match(/admin_token=([^;]+)/);
  expect(match).toBeTruthy();
  return `admin_token=${match![1]}`;
}

function seedSettings(db: ReturnType<typeof initDatabase>) {
  setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
  setSetting(db, "jwt_secret", "test-jwt-secret-for-testing");
  setSetting(db, "admin_password_hash", hashPassword("test-admin-pass"));
  setSetting(db, "initialized", "true");
}

describe("Admin Session States", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof initDatabase>;
  let close: () => Promise<void>;
  let cookie: string;
  let routerKeyId: string;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    seedSettings(db);
    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);

    // 通过 API 创建 router_key
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/router-keys",
      headers: { cookie, "content-type": "application/json" },
      payload: { name: "Test Router Key" },
    });
    expect(res.statusCode).toBe(201);
    routerKeyId = res.json().data.id;

    // 直接用 DB 函数写入 session state 数据
    upsertSessionState(db, {
      router_key_id: routerKeyId,
      session_id: "sess-001",
      current_model: "claude-opus-4-20250514",
      original_model: "claude-sonnet-4-20250514",
    });
    insertSessionHistory(db, {
      router_key_id: routerKeyId,
      session_id: "sess-001",
      old_model: "claude-sonnet-4-20250514",
      new_model: "claude-opus-4-20250514",
      trigger_type: "directive",
    });
  });

  afterEach(async () => {
    await close();
  });

  it("GET /admin/api/session-states returns list with router_key_name", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/session-states",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const states = res.json().data;
    expect(states).toHaveLength(1);
    expect(states[0].router_key_name).toBe("Test Router Key");
    expect(states[0].session_id).toBe("sess-001");
    expect(states[0].current_model).toBe("claude-opus-4-20250514");
  });

  it("GET /admin/api/session-states/:keyId/:sessionId/history returns history", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/admin/api/session-states/${routerKeyId}/sess-001/history`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const history = res.json().data;
    expect(history).toHaveLength(1);
    expect(history[0].old_model).toBe("claude-sonnet-4-20250514");
    expect(history[0].new_model).toBe("claude-opus-4-20250514");
    expect(history[0].trigger_type).toBe("directive");
  });

  it("DELETE /admin/api/session-states/:keyId/:sessionId deletes state", async () => {
    const delRes = await app.inject({
      method: "DELETE",
      url: `/admin/api/session-states/${routerKeyId}/sess-001`,
      headers: { cookie },
    });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json().data).toEqual({ success: true });

    // 验证 session state 已被删除
    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/session-states",
      headers: { cookie },
    });
    expect(getRes.json().data).toHaveLength(0);
  });

  it("unauthenticated access returns 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/session-states",
    });
    expect(res.statusCode).toBe(401);
    const body = res.json()
    expect(body.code).toBe(40102)
    expect(body.data).toBeNull()
  });
});

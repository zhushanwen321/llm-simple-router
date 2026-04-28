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

function insertTestLogs(db: ReturnType<typeof initDatabase>) {
  const now = new Date();
  const stmt = db.prepare(
    `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.run("log-1", "openai", "gpt-4", null, 200, 300, 1, null, now.toISOString());
  stmt.run("log-2", "anthropic", "claude-3", null, 200, 500, 0, null, new Date(now.getTime() - 1000).toISOString());
  stmt.run("log-3", "openai", "gpt-4", null, 502, 5000, 1, "timeout", new Date(now.getTime() - 2000).toISOString());
  stmt.run("log-4", "openai", "gpt-3.5-turbo", null, 200, 150, 1, null, new Date(now.getTime() - 86400000 * 2).toISOString());

  // request_metrics 对应 log-1, log-2（成功请求，is_complete=1）
  const metricStmt = db.prepare(
    `INSERT INTO request_metrics (id, request_log_id, provider_id, backend_model, api_type, status_code, input_tokens, output_tokens, ttft_ms, tokens_per_second, is_complete, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  metricStmt.run("m-1", "log-1", "prov-1", "gpt-4", "openai", 200, 100, 200, 50, 30, 1, now.toISOString());
  metricStmt.run("m-2", "log-2", "prov-2", "claude-3", "anthropic", 200, 150, 250, 80, 40, 1, new Date(now.getTime() - 1000).toISOString());
  // log-3 is 502 failure — no metrics entry (incomplete)
}

describe("Logs API", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof initDatabase>;
  let close: () => Promise<void>;
  let cookie: string;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    insertTestLogs(db);
    seedSettings(db);
    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);
  });

  afterEach(async () => {
    await close();
  });

  it("GET logs returns paginated results", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs?page=1&limit=10",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.data.length).toBe(4);
    expect(body.total).toBe(4);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(10);
  });

  it("GET logs filters by api_type", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs?api_type=openai",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.data.every((l: any) => l.api_type === "openai")).toBe(true);
  });

  it("DELETE logs before date", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/admin/api/logs/before",
      headers: { cookie, "content-type": "application/json" },
      payload: { before: new Date().toISOString() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.deleted).toBe(4);
  });

  it("unauthenticated returns 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs",
    });
    expect(res.statusCode).toBe(401);
    const body = res.json()
    expect(body.code).toBe(40102)
    expect(body.data).toBeNull()
  });
});

describe("Stats API", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof initDatabase>;
  let close: () => Promise<void>;
  let cookie: string;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    insertTestLogs(db);
    seedSettings(db);
    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);
  });

  afterEach(async () => {
    await close();
  });

  it("GET stats returns correct aggregate", async () => {
    const now = new Date();
    const startTime = new Date(now.getTime() - 86400000).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
    const endTime = new Date(now.getTime() + 86400000).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
    const res = await app.inject({
      method: "GET",
      url: `/admin/api/stats?start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const stats = res.json().data;
    expect(stats.totalRequests).toBe(2); // only log-1, log-2 have metrics
    expect(stats.successRate).toBe(1); // both have status 200
    expect(stats.avgTps).toBeGreaterThanOrEqual(0);
    expect(stats.totalInputTokens).toBeGreaterThanOrEqual(0);
    expect(stats.totalOutputTokens).toBeGreaterThanOrEqual(0);
  });

  it("GET stats with empty database", async () => {
    const emptyDb = initDatabase(":memory:");
    seedSettings(emptyDb);
    const result = await buildApp({ config: makeConfig() as any, db: emptyDb });
    const emptyApp = result.app;
    const emptyClose = result.close;
    const emptyCookie = await login(emptyApp);

    const res = await emptyApp.inject({
      method: "GET",
      url: "/admin/api/stats",
      headers: { cookie: emptyCookie },
    });
    expect(res.statusCode).toBe(200);
    const stats = res.json().data;
    expect(stats.totalRequests).toBe(0);
    expect(stats.successRate).toBe(0);
    expect(stats.avgTps).toBe(0);
    expect(stats.totalInputTokens).toBe(0);
    expect(stats.totalOutputTokens).toBe(0);

    await emptyClose();
  });

  it("unauthenticated returns 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/stats",
    });
    expect(res.statusCode).toBe(401);
    const body = res.json()
    expect(body.code).toBe(40102)
    expect(body.data).toBeNull()
  });
});

describe("Log children endpoint", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof initDatabase>;
  let close: () => Promise<void>;
  let cookie: string;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    seedSettings(db);

    const now = new Date();
    db.prepare(
      `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, error_message, created_at, is_retry, is_failover, original_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("root-1", "openai", "gpt-4", "prov-1", 500, 1000, 0, "server error", now.toISOString(), 0, 0, null);
    db.prepare(
      `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, error_message, created_at, is_retry, is_failover, original_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("child-retry", "openai", "gpt-4", "prov-1", 200, 800, 0, null, new Date(now.getTime() + 50).toISOString(), 1, 0, "root-1");
    db.prepare(
      `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, error_message, created_at, is_retry, is_failover, original_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("child-failover", "openai", "gpt-4", "prov-2", 200, 500, 0, null, new Date(now.getTime() + 100).toISOString(), 0, 1, "root-1");

    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);
  });

  afterEach(async () => {
    await close();
  });

  it("returns children sorted by created_at ASC", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs/root-1/children",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe("child-retry");
    expect(body[1].id).toBe("child-failover");
    expect(body[0].is_retry).toBe(1);
    expect(body[1].is_failover).toBe(1);
  });

  it("returns empty array for a leaf request with no children", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs/child-retry/children",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("returns 404 for nonexistent parent", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs/nonexistent-id/children",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toBe("Log not found");
  });

  it("unauthenticated returns 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs/root-1/children",
    });
    expect(res.statusCode).toBe(401);
    const body = res.json()
    expect(body.code).toBe(40102)
    expect(body.data).toBeNull()
  });
});

describe("Grouped logs view", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof initDatabase>;
  let close: () => Promise<void>;
  let cookie: string;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    seedSettings(db);

    const now = new Date();
    const stmt = db.prepare(
      `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, error_message, created_at, is_retry, is_failover, original_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    // 根请求 1：有 2 个子请求
    stmt.run("root-1", "openai", "gpt-4", "prov-1", 500, 1000, 0, "server error", now.toISOString(), 0, 0, null);
    stmt.run("child-retry-1", "openai", "gpt-4", "prov-1", 200, 800, 0, null, new Date(now.getTime() + 50).toISOString(), 1, 0, "root-1");
    stmt.run("child-failover-1", "openai", "gpt-4", "prov-2", 200, 500, 0, null, new Date(now.getTime() + 100).toISOString(), 0, 1, "root-1");

    // 根请求 2：无子请求
    stmt.run("root-2", "anthropic", "claude-3", "prov-3", 200, 300, 0, null, new Date(now.getTime() + 200).toISOString(), 0, 0, null);

    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);
  });

  afterEach(async () => {
    await close();
  });

  it("returns only root requests with correct child_count", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs?view=grouped",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    // 只返回根请求（original_request_id IS NULL）
    expect(body.data).toHaveLength(2);
    expect(body.total).toBe(2);

    // 按 created_at DESC 排序，root-2 在前
    expect(body.data[0].id).toBe("root-2");
    expect(body.data[0].child_count).toBe(0);

    expect(body.data[1].id).toBe("root-1");
    expect(body.data[1].child_count).toBe(2);
  });

  it("child requests do not appear in grouped view", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs?view=grouped",
      headers: { cookie },
    });
    const body = res.json().data;
    const ids = body.data.map((l: any) => l.id);
    expect(ids).not.toContain("child-retry-1");
    expect(ids).not.toContain("child-failover-1");
  });

  it("grouped view supports api_type filter", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs?view=grouped&api_type=openai",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("root-1");
  });
});

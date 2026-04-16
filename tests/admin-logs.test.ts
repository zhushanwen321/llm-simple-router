import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const ADMIN_PASSWORD = "test-admin-pass";
const JWT_SECRET = "test-jwt-secret-for-testing";
const API_KEY = "sk-test-key";

function makeConfig() {
  return {
    ROUTER_API_KEY: API_KEY,
    ADMIN_PASSWORD,
    JWT_SECRET,
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    PORT: 3000,
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
    payload: { password: ADMIN_PASSWORD },
  });
  const match = (res.headers["set-cookie"] as string).match(/admin_token=([^;]+)/);
  return `admin_token=${match![1]}`;
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
    `INSERT INTO request_metrics (id, request_log_id, provider_id, backend_model, api_type, input_tokens, output_tokens, ttft_ms, tokens_per_second, is_complete, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  metricStmt.run("m-1", "log-1", "prov-1", "gpt-4", "openai", 100, 200, 50, 30, 1, now.toISOString());
  metricStmt.run("m-2", "log-2", "prov-2", "claude-3", "anthropic", 150, 250, 80, 40, 1, new Date(now.getTime() - 1000).toISOString());
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
    const body = res.json();
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
    const body = res.json();
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
    expect(res.json().deleted).toBe(4);
  });

  it("unauthenticated returns 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs",
    });
    expect(res.statusCode).toBe(401);
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
    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);
  });

  afterEach(async () => {
    await close();
  });

  it("GET stats returns correct aggregate", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/stats",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(stats.totalRequests).toBe(2); // only log-1, log-2 have metrics
    expect(stats.successRate).toBe(1); // both have status 200
    expect(stats.avgTps).toBeGreaterThanOrEqual(0);
    expect(stats.totalTokens).toBeGreaterThanOrEqual(0);
  });

  it("GET stats with empty database", async () => {
    const emptyDb = initDatabase(":memory:");
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
    const stats = res.json();
    expect(stats.totalRequests).toBe(0);
    expect(stats.successRate).toBe(0);
    expect(stats.avgTps).toBe(0);
    expect(stats.totalTokens).toBe(0);

    await emptyClose();
  });

  it("unauthenticated returns 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/stats",
    });
    expect(res.statusCode).toBe(401);
  });
});

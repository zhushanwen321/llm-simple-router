import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { buildApp } from "../src/index.js";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const ADMIN_PASSWORD = "test-admin-pass";
const API_KEY = "sk-test-key";

function makeConfig() {
  return {
    ROUTER_API_KEY: API_KEY,
    ADMIN_PASSWORD,
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    PORT: 3000,
    DB_PATH: ":memory:",
    LOG_LEVEL: "silent",
    TZ: "Asia/Shanghai",
    STREAM_TIMEOUT_MS: 5000,
  };
}

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS backend_services (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, api_type TEXT NOT NULL CHECK(api_type IN ('openai', 'anthropic')),
      base_url TEXT NOT NULL, api_key TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_mappings (
      id TEXT PRIMARY KEY, client_model TEXT NOT NULL UNIQUE, backend_model TEXT NOT NULL,
      backend_service_id TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
      FOREIGN KEY (backend_service_id) REFERENCES backend_services(id)
    );
    CREATE TABLE IF NOT EXISTS request_logs (
      id TEXT PRIMARY KEY, api_type TEXT NOT NULL, model TEXT, backend_service_id TEXT,
      status_code INTEGER, latency_ms INTEGER, is_stream INTEGER, error_message TEXT, created_at TEXT NOT NULL,
      request_body TEXT, response_body TEXT, client_request TEXT, upstream_request TEXT, upstream_response TEXT, client_response TEXT
    );
  `);
  return db;
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

function insertTestLogs(db: Database.Database) {
  const now = new Date();
  const stmt = db.prepare(
    `INSERT INTO request_logs (id, api_type, model, backend_service_id, status_code, latency_ms, is_stream, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.run("log-1", "openai", "gpt-4", null, 200, 300, 1, null, now.toISOString());
  stmt.run("log-2", "anthropic", "claude-3", null, 200, 500, 0, null, new Date(now.getTime() - 1000).toISOString());
  stmt.run("log-3", "openai", "gpt-4", null, 502, 5000, 1, "timeout", new Date(now.getTime() - 2000).toISOString());
  stmt.run("log-4", "openai", "gpt-3.5-turbo", null, 200, 150, 1, null, new Date(now.getTime() - 86400000 * 2).toISOString());
}

describe("Logs API", () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let close: () => Promise<void>;
  let cookie: string;

  beforeEach(async () => {
    db = createTestDb();
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
  let db: Database.Database;
  let close: () => Promise<void>;
  let cookie: string;

  beforeEach(async () => {
    db = createTestDb();
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
    expect(stats.totalRequests).toBe(4);
    expect(stats.successRate).toBe(0.75); // 3 out of 4
    expect(stats.avgLatency).toBeGreaterThan(0);
    expect(stats.requestsByType.openai).toBe(3);
    expect(stats.requestsByType.anthropic).toBe(1);
  });

  it("GET stats with empty database", async () => {
    const emptyDb = createTestDb();
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
    expect(stats.avgLatency).toBe(0);

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

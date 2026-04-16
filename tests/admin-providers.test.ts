import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { buildApp } from "../src/index.js";

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
  const setCookie = res.headers["set-cookie"];
  expect(setCookie).toBeDefined();
  const match = (setCookie as string).match(/admin_token=([^;]+)/);
  expect(match).toBeTruthy();
  return `admin_token=${match![1]}`;
}

function setupTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, api_type TEXT NOT NULL CHECK(api_type IN ('openai', 'anthropic')),
      base_url TEXT NOT NULL, api_key TEXT NOT NULL, api_key_preview TEXT, is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_mappings (
      id TEXT PRIMARY KEY, client_model TEXT NOT NULL UNIQUE, backend_model TEXT NOT NULL,
      provider_id TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
      FOREIGN KEY (provider_id) REFERENCES providers(id)
    );
    CREATE TABLE IF NOT EXISTS request_logs (
      id TEXT PRIMARY KEY, api_type TEXT NOT NULL, model TEXT, provider_id TEXT,
      status_code INTEGER, latency_ms INTEGER, is_stream INTEGER, error_message TEXT, created_at TEXT NOT NULL,
      request_body TEXT, response_body TEXT, client_request TEXT, upstream_request TEXT, upstream_response TEXT, client_response TEXT,
      is_retry INTEGER NOT NULL DEFAULT 0, original_request_id TEXT
    );
  `);
}

describe("Admin Auth", () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let close: () => Promise<void>;

  beforeEach(async () => {
    db = new Database(":memory:");
    setupTables(db);
    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
  });

  afterEach(async () => {
    await close();
  });

  it("login with correct password returns cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/login",
      payload: { password: ADMIN_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(res.headers["set-cookie"]).toContain("admin_token");
  });

  it("login with wrong password returns 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/login",
      payload: { password: "wrong" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("unauthenticated CRUD returns 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/providers",
    });
    expect(res.statusCode).toBe(401);
  });

  it("logout clears cookie", async () => {
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/logout",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("Provider CRUD", () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let close: () => Promise<void>;
  let cookie: string;

  beforeEach(async () => {
    db = new Database(":memory:");
    setupTables(db);
    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);
  });

  afterEach(async () => {
    await close();
  });

  it("GET services returns empty list", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/providers",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("POST creates service successfully", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "Test OpenAI",
        api_type: "openai",
        base_url: "https://api.openai.com",
        api_key: "sk-test-abc123xyz",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBeDefined();
  });

  it("GET returns services with api_key_preview instead of raw api_key", async () => {
    await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "Test OpenAI",
        api_type: "openai",
        base_url: "https://api.openai.com",
        api_key: "sk-test-abc123xyz",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/admin/api/providers",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const services = res.json();
    expect(services.length).toBe(1);
    expect(services[0].api_key_preview).toBe("sk-t...3xyz");
    expect(services[0].api_key).toBeUndefined();
  });

  it("PUT updates service", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "Test OpenAI",
        api_type: "openai",
        base_url: "https://api.openai.com",
        api_key: "sk-test-key123",
      },
    });
    const id = createRes.json().id;

    const updateRes = await app.inject({
      method: "PUT",
      url: `/admin/api/providers/${id}`,
      headers: { cookie, "content-type": "application/json" },
      payload: { name: "Updated Name" },
    });
    expect(updateRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/providers",
      headers: { cookie },
    });
    expect(getRes.json()[0].name).toBe("Updated Name");
  });

  it("DELETE removes service", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "Test OpenAI",
        api_type: "openai",
        base_url: "https://api.openai.com",
        api_key: "sk-test-key456",
      },
    });
    const id = createRes.json().id;

    const delRes = await app.inject({
      method: "DELETE",
      url: `/admin/api/providers/${id}`,
      headers: { cookie },
    });
    expect(delRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/providers",
      headers: { cookie },
    });
    expect(getRes.json()).toEqual([]);
  });

  it("POST with missing required field returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: { name: "NoKey" },
    });
    expect(res.statusCode).toBe(400);
  });
});

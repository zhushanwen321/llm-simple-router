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

describe("Mapping CRUD", () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let close: () => Promise<void>;
  let cookie: string;
  let serviceId: string;

  beforeEach(async () => {
    db = createTestDb();
    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);

    // 创建一个后端服务供映射使用
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/services",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "Test Service",
        api_type: "openai",
        base_url: "https://api.openai.com",
        api_key: "sk-test-abc123xyz",
      },
    });
    serviceId = res.json().id;
  });

  afterEach(async () => {
    await close();
  });

  it("GET mappings returns empty list", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/mappings",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("POST creates mapping", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mappings",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        backend_model: "gpt-4-turbo",
        backend_service_id: serviceId,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBeDefined();
  });

  it("GET returns mappings", async () => {
    await app.inject({
      method: "POST",
      url: "/admin/api/mappings",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        backend_model: "gpt-4-turbo",
        backend_service_id: serviceId,
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/admin/api/mappings",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBe(1);
    expect(res.json()[0].client_model).toBe("gpt-4");
  });

  it("PUT updates mapping", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/admin/api/mappings",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        backend_model: "gpt-4-turbo",
        backend_service_id: serviceId,
      },
    });
    const id = createRes.json().id;

    await app.inject({
      method: "PUT",
      url: `/admin/api/mappings/${id}`,
      headers: { cookie, "content-type": "application/json" },
      payload: { backend_model: "gpt-4o" },
    });

    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/mappings",
      headers: { cookie },
    });
    expect(getRes.json()[0].backend_model).toBe("gpt-4o");
  });

  it("DELETE removes mapping", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/admin/api/mappings",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        backend_model: "gpt-4-turbo",
        backend_service_id: serviceId,
      },
    });
    const id = createRes.json().id;

    const delRes = await app.inject({
      method: "DELETE",
      url: `/admin/api/mappings/${id}`,
      headers: { cookie },
    });
    expect(delRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/mappings",
      headers: { cookie },
    });
    expect(getRes.json()).toEqual([]);
  });

  it("POST duplicate client_model returns 409", async () => {
    await app.inject({
      method: "POST",
      url: "/admin/api/mappings",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        backend_model: "gpt-4-turbo",
        backend_service_id: serviceId,
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mappings",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        backend_model: "gpt-4",
        backend_service_id: serviceId,
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it("POST with non-existent service_id returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mappings",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        backend_model: "gpt-4-turbo",
        backend_service_id: "non-existent",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("unauthenticated access returns 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/mappings",
    });
    expect(res.statusCode).toBe(401);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createHash } from "crypto";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { authMiddleware } from "../src/middleware/auth.js";
import Database from "better-sqlite3";
import { ServiceContainer } from "../src/core/container.js";


const TEST_KEY = "sk-router-test-key-1234567890";
const TEST_KEY_HASH = createHash("sha256").update(TEST_KEY).digest("hex");

function buildTestApp() {
  const db = initDatabase(":memory:");
  setSetting(db, "initialized", "true");
  db.prepare(
    "INSERT INTO router_keys (id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?)"
  ).run("test-id", "Test Key", TEST_KEY_HASH, TEST_KEY.slice(0, 8));

  const app = Fastify();
  app.register(authMiddleware, { db });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/admin/dashboard", async () => ({ page: "admin" }));
  app.get("/v1/chat/completions", async (request) => ({ result: "proxied", key: request.routerKey?.name }));

  return { app, db };
}

describe("auth middleware", () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(() => {
    const test = buildTestApp();
    app = test.app;
    db = test.db;
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("should allow /health without auth", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("should allow /admin/* without auth", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ page: "admin" });
  });

  it("should reject request without Authorization header", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/chat/completions",
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.code).toBe("invalid_api_key");
  });

  it("should reject request with wrong API key", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/chat/completions",
      headers: {
        authorization: "Bearer wrong-key",
      },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.message).toBe("Invalid API key");
  });

  it("should allow request with correct Bearer token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${TEST_KEY}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.result).toBe("proxied");
    expect(body.key).toBe("Test Key");
  });

  it("should reject malformed Authorization header", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/chat/completions",
      headers: {
        authorization: "Basic some-credentials",
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it("should NOT write to request_logs on auth failure (BI-M5)", async () => {
    const logCount = db.prepare("SELECT COUNT(*) as count FROM request_logs").get() as { count: number };
    expect(logCount.count).toBe(0);

    const response = await app.inject({
      method: "GET",
      url: "/v1/chat/completions",
    });

    expect(response.statusCode).toBe(401);

    const logCountAfter = db.prepare("SELECT COUNT(*) as count FROM request_logs").get() as { count: number };
    expect(logCountAfter.count).toBe(0);
  });

  it("should return OpenAI-compatible error format", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/chat/completions",
    });

    const body = response.json();
    expect(body).toEqual({
      error: {
        message: "Invalid API key",
        type: "invalid_request_error",
        code: "invalid_api_key",
      },
    });
  });

  it("should reject request with inactive router key", async () => {
    db.prepare("UPDATE router_keys SET is_active = 0 WHERE id = ?").run("test-id");

    const response = await app.inject({
      method: "GET",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${TEST_KEY}`,
      },
    });

    expect(response.statusCode).toBe(401);
  });
});

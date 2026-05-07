import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";
import { makeConfig, seedSettings, login } from "./helpers/test-setup.js";
import { createMockBackend, type MockBackend } from "./helpers/mock-backend.js";

describe("Provider Fetch Models", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof initDatabase>;
  let close: () => Promise<void>;
  let cookie: string;
  let mockBackend: MockBackend;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    seedSettings(db);
    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);
  });

  afterEach(async () => {
    await mockBackend?.close?.();
    await close();
  });

  it("fetches models from OpenAI-compatible upstream", async () => {
    mockBackend = await createMockBackend((req, res) => {
      expect(req.url).toBe("/v1/models");
      expect(req.headers["authorization"]).toBe("Bearer test-api-key");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        object: "list",
        data: [
          { id: "gpt-4o", object: "model", created: 1234567890, owned_by: "openai" },
          { id: "gpt-4o-mini", object: "model", created: 1234567890, owned_by: "openai" },
        ],
      }));
    });

    const res = await app.inject({
      method: "POST",
      url: "/admin/api/providers/fetch-models",
      headers: { cookie },
      payload: {
        base_url: `http://127.0.0.1:${mockBackend.port}`,
        models_endpoint: "/v1/models",
        api_key: "test-api-key",
        api_type: "openai",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toEqual(["gpt-4o", "gpt-4o-mini"]);
  });

  it("fetches models from Anthropic-compatible upstream", async () => {
    mockBackend = await createMockBackend((req, res) => {
      expect(req.headers["x-api-key"]).toBe("test-anthropic-key");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        data: [
          { type: "model", id: "claude-sonnet-4-20250514", display_name: "Claude Sonnet 4" },
          { type: "model", id: "claude-opus-4-20250514", display_name: "Claude Opus 4" },
        ],
        has_more: false,
      }));
    });

    const res = await app.inject({
      method: "POST",
      url: "/admin/api/providers/fetch-models",
      headers: { cookie },
      payload: {
        base_url: `http://127.0.0.1:${mockBackend.port}`,
        models_endpoint: "/v1/models",
        api_key: "test-anthropic-key",
        api_type: "anthropic",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toEqual(["claude-opus-4-20250514", "claude-sonnet-4-20250514"]);
  });

  it("returns error when upstream returns non-200", async () => {
    mockBackend = await createMockBackend((_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid API key" } }));
    });

    const res = await app.inject({
      method: "POST",
      url: "/admin/api/providers/fetch-models",
      headers: { cookie },
      payload: {
        base_url: `http://127.0.0.1:${mockBackend.port}`,
        models_endpoint: "/v1/models",
        api_key: "bad-key",
        api_type: "openai",
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe(40001);
    expect(body.message).toContain("401");
  });

  it("returns error when upstream is unreachable", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/providers/fetch-models",
      headers: { cookie },
      payload: {
        base_url: "http://127.0.0.1:1",
        models_endpoint: "/v1/models",
        api_key: "test-key",
        api_type: "openai",
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.message).toContain("连接上游失败");
  });

  it("requires authentication", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/providers/fetch-models",
      payload: {
        base_url: "https://api.example.com",
        models_endpoint: "/v1/models",
        api_key: "test-key",
        api_type: "openai",
      },
    });

    expect(res.statusCode).toBe(401);
  });
});

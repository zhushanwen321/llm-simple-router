import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { openaiProxy } from "../src/proxy/handler/openai.js";
import { encrypt } from "../src/utils/crypto.js";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { ServiceContainer, SERVICE_KEYS } from "../src/core/container.js";

const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function insertProvider(
  db: Database.Database,
  overrides: Record<string, any> = {},
) {
  const now = new Date().toISOString();
  const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);
  const defaults = {
    id: "provider-1",
    name: "Mock Provider",
    api_type: "openai",
    base_url: "http://127.0.0.1:9999",
    api_key: encryptedKey,
    models: '["gpt-4", "gpt-3.5-turbo"]',
    is_active: 1,
    max_concurrency: 0,
    queue_timeout_ms: 0,
    max_queue_size: 100,
    adaptive_enabled: 0,
    created_at: now,
    updated_at: now,
  };
  const row = { ...defaults, ...overrides };
  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active, max_concurrency, queue_timeout_ms, max_queue_size, adaptive_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.name,
    row.api_type,
    row.base_url,
    row.api_key,
    row.models,
    row.is_active,
    row.max_concurrency,
    row.queue_timeout_ms,
    row.max_queue_size,
    row.adaptive_enabled,
    row.created_at,
    row.updated_at,
  );
}

function buildApp(db: Database.Database): FastifyInstance {
  const app = Fastify();
  const container = new ServiceContainer();
  container.register("semaphoreManager", () => undefined);
  container.register("tracker", () => undefined);
  container.register("matcher", () => undefined);
  container.register("usageWindowTracker", () => undefined);
  container.register("sessionTracker", () => undefined);
  container.register("adaptiveController", () => undefined);
  container.register(SERVICE_KEYS.logFileWriter, () => null);
  container.register(SERVICE_KEYS.pluginRegistry, () => undefined);
  app.register(openaiProxy, { db, container });
  return app;
}

describe("GET /v1/models — aggregate from all providers", () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
  });

  afterEach(async () => {
    if (app) await app.close();
    if (db) db.close();
  });

  // ---- OpenAI format ----

  it("should return models from all providers in OpenAI format", async () => {
    insertProvider(db, {
      id: "p-openai",
      name: "OpenAI",
      api_type: "openai",
      models: '["gpt-4", "gpt-3.5-turbo"]',
    });
    insertProvider(db, {
      id: "p-anthropic",
      name: "Anthropic",
      api_type: "anthropic",
      models: '["claude-3-opus", "claude-3-sonnet"]',
    });

    app = buildApp(db);

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.object).toBe("list");
    expect(body.data).toHaveLength(4);
    const ids = body.data.map((d: any) => d.id);
    // sorted alphabetically
    expect(ids).toEqual(["claude-3-opus", "claude-3-sonnet", "gpt-3.5-turbo", "gpt-4"]);
    // each item has OpenAI shape
    for (const item of body.data) {
      expect(item.object).toBe("model");
      expect(item).toHaveProperty("created");
      expect(item).toHaveProperty("owned_by");
    }
  });

  it("should deduplicate models across providers", async () => {
    insertProvider(db, {
      id: "p1",
      name: "Provider A",
      models: '["gpt-4", "shared-model"]',
    });
    insertProvider(db, {
      id: "p2",
      name: "Provider B",
      models: '["shared-model", "unique-model"]',
    });

    app = buildApp(db);

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const ids = body.data.map((d: any) => d.id);
    expect(ids).toEqual(["gpt-4", "shared-model", "unique-model"]);
    // shared-model should use one of the providers' names (order depends on getAllProviders which sorts by created_at DESC)
    const shared = body.data.find((d: any) => d.id === "shared-model");
    expect(["Provider A", "Provider B"]).toContain(shared.owned_by);
  });

  it("should return empty list when no providers exist", async () => {
    app = buildApp(db);

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.object).toBe("list");
    expect(body.data).toHaveLength(0);
  });

  it("should exclude inactive providers", async () => {
    insertProvider(db, {
      id: "p-active",
      name: "Active",
      models: '["gpt-4"]',
      is_active: 1,
    });
    insertProvider(db, {
      id: "p-inactive",
      name: "Inactive",
      models: '["claude-3-opus"]',
      is_active: 0,
    });

    app = buildApp(db);

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("gpt-4");
  });

  it("should work on /models compat path", async () => {
    insertProvider(db, {
      id: "p1",
      name: "Test",
      models: '["gpt-4"]',
    });

    app = buildApp(db);

    const response = await app.inject({
      method: "GET",
      url: "/models",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.object).toBe("list");
    expect(body.data[0].id).toBe("gpt-4");
  });

  // ---- Anthropic format ----

  it("should return Anthropic format when anthropic-version header is present", async () => {
    insertProvider(db, {
      id: "p-openai",
      name: "OpenAI",
      api_type: "openai",
      models: '["gpt-4"]',
    });
    insertProvider(db, {
      id: "p-anthropic",
      name: "Anthropic",
      api_type: "anthropic",
      models: '["claude-3-opus"]',
    });

    app = buildApp(db);

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { "anthropic-version": "2023-06-01" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).not.toHaveProperty("object");
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("has_more");
    expect(body).toHaveProperty("first_id");
    expect(body).toHaveProperty("last_id");
    expect(body.data).toHaveLength(2);
    // sorted alphabetically
    expect(body.data[0].id).toBe("claude-3-opus");
    expect(body.data[1].id).toBe("gpt-4");
    // each item has Anthropic shape
    for (const item of body.data) {
      expect(item.type).toBe("model");
      expect(item).toHaveProperty("display_name");
      expect(item).toHaveProperty("created_at");
    }
  });

  it("should support ?limit parameter for Anthropic format", async () => {
    insertProvider(db, {
      id: "p1",
      name: "Provider",
      models: '["a-model", "b-model", "c-model", "d-model", "e-model"]',
    });

    app = buildApp(db);

    const response = await app.inject({
      method: "GET",
      url: "/v1/models?limit=3",
      headers: { "anthropic-version": "2023-06-01" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(3);
    expect(body.has_more).toBe(true);
    expect(body.first_id).toBe("a-model");
    expect(body.last_id).toBe("c-model");
  });

  it("should support ?after_id cursor for Anthropic format", async () => {
    insertProvider(db, {
      id: "p1",
      name: "Provider",
      models: '["a-model", "b-model", "c-model", "d-model"]',
    });

    app = buildApp(db);

    const response = await app.inject({
      method: "GET",
      url: "/v1/models?limit=2&after_id=b-model",
      headers: { "anthropic-version": "2023-06-01" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe("c-model");
    expect(body.data[1].id).toBe("d-model");
    expect(body.has_more).toBe(false);
  });

  it("should support ?before_id cursor for Anthropic format", async () => {
    insertProvider(db, {
      id: "p1",
      name: "Provider",
      models: '["a-model", "b-model", "c-model", "d-model"]',
    });

    app = buildApp(db);

    const response = await app.inject({
      method: "GET",
      url: "/v1/models?limit=2&before_id=d-model",
      headers: { "anthropic-version": "2023-06-01" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe("b-model");
    expect(body.data[1].id).toBe("c-model");
    expect(body.has_more).toBe(true);
  });

  it("should return empty Anthropic response when no models", async () => {
    app = buildApp(db);

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { "anthropic-version": "2023-06-01" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(0);
    expect(body.has_more).toBe(false);
    expect(body.first_id).toBeNull();
    expect(body.last_id).toBeNull();
  });

  it("should return Anthropic format on /models compat path", async () => {
    insertProvider(db, {
      id: "p1",
      name: "Test",
      models: '["claude-3-opus"]',
    });

    app = buildApp(db);

    const response = await app.inject({
      method: "GET",
      url: "/models",
      headers: { "anthropic-version": "2023-06-01" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].type).toBe("model");
    expect(body.data[0].id).toBe("claude-3-opus");
  });
});

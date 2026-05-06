import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { Server } from "http";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { encrypt } from "../src/utils/crypto.js";
import { openaiProxy } from "../src/proxy/handler/openai.js";
import { SemaphoreManager as ProviderSemaphoreManager } from "@llm-router/core/concurrency";
import { RequestTracker } from "@llm-router/core/monitor";
import { ServiceContainer, SERVICE_KEYS } from "../src/core/container.js";
import { ProxyAgentFactory } from "../src/proxy/transport/proxy-agent.js";
import { createMockBackend } from "./helpers/mock-backend.js";
import { getModelStreamTimeout, DEFAULT_STREAM_TIMEOUT_MS } from "../src/db/providers.js";

const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// ---------- Test app builder ----------

function buildTestApp(mockDb: Database.Database): FastifyInstance {
  const app = Fastify();
  const semaphoreManager = new ProviderSemaphoreManager();
  const tracker = new RequestTracker({ semaphoreManager });
  const container = new ServiceContainer();
  container.register("semaphoreManager", () => semaphoreManager);
  container.register("tracker", () => tracker);
  container.register("matcher", () => undefined);
  container.register("usageWindowTracker", () => undefined);
  container.register("sessionTracker", () => undefined);
  container.register("adaptiveController", () => undefined);
  container.register(SERVICE_KEYS.logFileWriter, () => null);
  container.register(SERVICE_KEYS.pluginRegistry, () => undefined);
  container.register(SERVICE_KEYS.proxyAgentFactory, () => new ProxyAgentFactory());

  app.register(openaiProxy, { db: mockDb, container });

  return app;
}

// ---------- Mock data helpers ----------

function insertMockProvider(
  mockDb: Database.Database,
  baseUrl: string,
  models: string = "[]",
): void {
  const now = new Date().toISOString();
  const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);
  mockDb
    .prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, models, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "svc-openai", "MockOpenAI", "openai",
      baseUrl, encryptedKey, 1, models,
      now, now,
    );
}

function insertModelMapping(
  mockDb: Database.Database,
  clientModel: string,
  backendModel: string,
): void {
  const now = new Date().toISOString();
  mockDb.prepare(
    `INSERT INTO model_mappings (id, client_model, backend_model, provider_id, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("map-1", clientModel, backendModel, "svc-openai", 1, now);
  mockDb.prepare(
    `INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    "mg-1", clientModel,
    JSON.stringify({ targets: [{ backend_model: backendModel, provider_id: "svc-openai" }] }),
    1, now,
  );
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

// ---------- Tests ----------

describe("Stream timeout integration", () => {
  let app: FastifyInstance;
  let mockDb: Database.Database;

  beforeEach(() => {
    mockDb = initDatabase(":memory:");
    setSetting(mockDb, "encryption_key", TEST_ENCRYPTION_KEY);
  });

  afterEach(async () => {
    if (app) await app.close();
    if (mockDb) mockDb.close();
  });

  // 1. Per-model timeout triggers correctly
  it(
    "should abort stream after per-model stream_timeout_ms of silence",
    async () => {
      const TIMEOUT_MS = 500;
      const firstChunk = `data: ${JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion.chunk",
        choices: [{ delta: { content: "Hi" } }],
      })}\n\n`;

      // Mock upstream: send one SSE event, then go silent
      const { server, port, close } = await createMockBackend((req, res) => {
        let body = "";
        req.on("data", (chunk: Buffer) => (body += chunk));
        req.on("end", () => {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          res.write(firstChunk);
          // Go silent — simulate upstream stuck
          setTimeout(() => { try { res.end(); } catch { /* already closed */ } }, 5000);
        });
      });

      const models = JSON.stringify([
        { id: "glm-5.1", stream_timeout_ms: TIMEOUT_MS },
      ]);
      insertMockProvider(mockDb, `http://127.0.0.1:${port}`, models);
      insertModelMapping(mockDb, "glm-5.1", "glm-5.1");

      app = buildTestApp(mockDb);
      const start = Date.now();
      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "content-type": "application/json" },
        payload: {
          model: "glm-5.1",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
        },
      });
      const elapsed = Date.now() - start;

      // Should contain the first forwarded chunk
      expect(response.body).toContain("chatcmpl-test");

      // Should contain the timeout error event
      expect(response.body).toContain("stream_timeout");

      // Elapsed time should be roughly TIMEOUT_MS
      expect(elapsed).toBeGreaterThanOrEqual(TIMEOUT_MS - 100);
      expect(elapsed).toBeLessThan(TIMEOUT_MS + 3000);

      await closeServer(server);
      await close();
    },
    15_000,
  );

  // 2. Default timeout used when not configured
  it("should resolve default timeout when model has no stream_timeout_ms", () => {
    const provider = {
      models: JSON.stringify([{ id: "glm-5.1" }]),
    } as Record<string, unknown>;

    const timeout = getModelStreamTimeout(provider, "glm-5.1");
    expect(timeout).toBe(DEFAULT_STREAM_TIMEOUT_MS);
    expect(timeout).toBe(600_000);
  });

  it("should resolve default timeout when model not found in provider", () => {
    const provider = {
      models: JSON.stringify([{ id: "other-model", stream_timeout_ms: 5000 }]),
    } as Record<string, unknown>;

    const timeout = getModelStreamTimeout(provider, "glm-5.1");
    expect(timeout).toBe(DEFAULT_STREAM_TIMEOUT_MS);
  });

  // 3. Timeout error event format
  it(
    "should send properly formatted SSE error event on stream timeout",
    async () => {
      const TIMEOUT_MS = 500;
      const firstChunk = `data: ${JSON.stringify({
        id: "chatcmpl-err",
        object: "chat.completion.chunk",
        choices: [{ delta: { content: "partial" } }],
      })}\n\n`;

      const { server, port, close } = await createMockBackend((req, res) => {
        let body = "";
        req.on("data", (chunk: Buffer) => (body += chunk));
        req.on("end", () => {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          res.write(firstChunk);
          setTimeout(() => { try { res.end(); } catch { /* already closed */ } }, 5000);
        });
      });

      const models = JSON.stringify([
        { id: "glm-5.1", stream_timeout_ms: TIMEOUT_MS },
      ]);
      insertMockProvider(mockDb, `http://127.0.0.1:${port}`, models);
      insertModelMapping(mockDb, "glm-5.1", "glm-5.1");

      app = buildTestApp(mockDb);
      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "content-type": "application/json" },
        payload: {
          model: "glm-5.1",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
        },
      });

      const responseBody = response.body;

      // Should contain the timeout error in OpenAI format
      const errorLine = responseBody
        .split("\n")
        .find((line) => line.startsWith("data: ") && line.includes("stream_timeout"));

      expect(errorLine).toBeDefined();

      const errorPayload = JSON.parse(errorLine!.replace("data: ", ""));
      expect(errorPayload.error).toBeDefined();
      expect(errorPayload.error.type).toBe("server_error");
      expect(errorPayload.error.code).toBe("stream_timeout");
      expect(errorPayload.error.message).toContain("Stream timeout");
      expect(errorPayload.error.message).toContain("glm-5.1");
      expect(errorPayload.error.message).toContain(String(TIMEOUT_MS));

      await closeServer(server);
      await close();
    },
    15_000,
  );
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { createServer, Server, IncomingMessage, ServerResponse } from "http";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { encrypt } from "../src/utils/crypto.js";
import { createProxyHandler } from "../src/proxy/handler/create-proxy-handler.js";
import { FormatRegistry } from "../src/proxy/format/registry.js";
import { openaiAdapter } from "../src/proxy/format/adapters/openai.js";
import { SemaphoreManager as ProviderSemaphoreManager } from "../src/core/concurrency/index.js";
import { RequestTracker } from "../src/core/monitor/index.js";
import { ServiceContainer, SERVICE_KEYS } from "../src/core/container.js";
import { ProxyAgentFactory } from "../src/proxy/transport/proxy-agent.js";


const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function createMockBackend(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve({ server, port: addr.port });
      } else {
        reject(new Error("Failed to get server address"));
      }
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function buildTestApp(
  mockDb: Database.Database,
  semaphoreManager: ProviderSemaphoreManager
): FastifyInstance {
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

  const formatRegistry = new FormatRegistry();
  formatRegistry.registerAdapter(openaiAdapter);
  container.register(SERVICE_KEYS.formatRegistry, () => formatRegistry);
  const app = Fastify();
  app.register(createProxyHandler({ apiType: "openai", paths: ["/v1/chat/completions", "/chat/completions"] }), { db: mockDb, container });
  return app;
}

async function sendRequest(
  app: FastifyInstance,
  body: Record<string, unknown>
) {
  return app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: { "content-type": "application/json" },
    payload: body,
  });
}

function insertMockBackend(
  mockDb: Database.Database,
  baseUrl: string
): void {
  const now = new Date().toISOString();
  const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);
  mockDb
    .prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, max_concurrency, queue_timeout_ms, max_queue_size, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "svc-openai",
      "MockOpenAI",
      "openai",
      baseUrl,
      encryptedKey,
      1,
      0,
      0,
      100,
      now,
      now
    );
}

function insertModelMapping(
  mockDb: Database.Database,
  clientModel: string,
  backendModel: string
): void {
  const now = new Date().toISOString();
  mockDb
    .prepare(
      `INSERT INTO model_mappings (id, client_model, backend_model, provider_id, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run("map-1", clientModel, backendModel, "svc-openai", 1, now);
  mockDb
    .prepare(
      `INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      "mg-1",
      clientModel,
      JSON.stringify({ targets: [{ backend_model: backendModel, provider_id: "svc-openai" }] }),
      1,
      now
    );
}

const OPENAI_NON_STREAM_RESPONSE = {
  id: "chatcmpl-test",
  object: "chat.completion",
  model: "gpt-4",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Hello!" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
};

describe("Proxy semaphore", () => {
  let app: FastifyInstance;
  let mockDb: Database.Database;
  let semaphoreManager: ProviderSemaphoreManager;

  beforeEach(() => {
    mockDb = initDatabase(":memory:");
    setSetting(mockDb, "encryption_key", TEST_ENCRYPTION_KEY);
    semaphoreManager = new ProviderSemaphoreManager();
  });

  afterEach(async () => {
    if (app) await app.close();
    if (mockDb) mockDb.close();
  });

  it("releases semaphore after successful non-stream request", async () => {
    const { server: backendServer, port } = await createMockBackend(
      (req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(OPENAI_NON_STREAM_RESPONSE));
        });
      }
    );

    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);
    insertModelMapping(mockDb, "gpt-4", "gpt-4");
    semaphoreManager.updateConfig("svc-openai", {
      maxConcurrency: 2,
      queueTimeoutMs: 0,
      maxQueueSize: 0,
    });

    app = buildTestApp(mockDb, semaphoreManager);
    const response = await sendRequest(app, {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.statusCode).toBe(200);
    expect(semaphoreManager.getStatus("svc-openai").active).toBe(0);

    await closeServer(backendServer);
  });

  it("releases semaphore after failed upstream request", async () => {
    const { server: backendServer, port } = await createMockBackend(
      (_req, res) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Internal error" } }));
      }
    );

    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);
    insertModelMapping(mockDb, "gpt-4", "gpt-4");
    semaphoreManager.updateConfig("svc-openai", {
      maxConcurrency: 2,
      queueTimeoutMs: 0,
      maxQueueSize: 0,
    });

    app = buildTestApp(mockDb, semaphoreManager);
    const response = await sendRequest(app, {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.statusCode).toBe(500);
    expect(semaphoreManager.getStatus("svc-openai").active).toBe(0);

    await closeServer(backendServer);
  });

  it("returns 503 when queue is full", { timeout: 15_000 }, async () => {
    let releaseFirstRequest: () => void = () => {};
    const firstRequestPromise = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve;
    });

    const { server: backendServer, port } = await createMockBackend(
      (req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          // Hold the response until test signals release
          await firstRequestPromise;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(OPENAI_NON_STREAM_RESPONSE));
        });
      }
    );

    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);
    insertModelMapping(mockDb, "gpt-4", "gpt-4");
    // maxConcurrency=1, maxQueueSize=0 means second request is rejected immediately
    semaphoreManager.updateConfig("svc-openai", {
      maxConcurrency: 1,
      queueTimeoutMs: 0,
      maxQueueSize: 0,
    });

    app = buildTestApp(mockDb, semaphoreManager);

    // First request holds the semaphore (backend delays response)
    const slowPromise = sendRequest(app, {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hi" }],
    });

    // Give it a tick to acquire the semaphore
    await new Promise((r) => setTimeout(r, 50));

    // Second request should get 503
    const res2 = await sendRequest(app, {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(res2.statusCode).toBe(503);
    expect(res2.json().error.code).toBe("concurrency_queue_full");

    // Release the first request so the mock backend can finish
    releaseFirstRequest();
    const res1 = await slowPromise;
    expect(res1.statusCode).toBe(200);

    await closeServer(backendServer);
  });
});

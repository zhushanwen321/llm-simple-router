import { describe, it, expect, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { createServer, Server, IncomingMessage, ServerResponse } from "http";
import Database from "better-sqlite3";
import { encrypt } from "../src/utils/crypto.js";
import { anthropicProxy } from "../src/proxy/handler/anthropic.js";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { RetryRuleMatcher } from "../src/proxy/orchestration/retry-rules.js";
import { ProviderSemaphoreManager } from "../src/proxy/orchestration/semaphore.js";
import { RequestTracker } from "../src/monitor/request-tracker.js";
import { ServiceContainer } from "../src/core/container.js";


const TEST_KEY =
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

function closeServer(s: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    s.close((err) => (err ? reject(err) : resolve()));
  });
}

function setupProvider(db: Database.Database, baseUrl: string) {
  const now = new Date().toISOString();
  const encryptedKey = encrypt("sk-ant-backend-key", TEST_KEY);
  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("svc-anthropic", "MockAnthropic", "anthropic", baseUrl, encryptedKey, 1, now, now);

  db.prepare(
    `INSERT INTO model_mappings (id, client_model, backend_model, provider_id, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run("map-sonnet", "sonnet", "mock-model", "svc-anthropic", 1, now);
  db.prepare(
    `INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    "mg-sonnet",
    "sonnet",
    JSON.stringify({ targets: [{ backend_model: "mock-model", provider_id: "svc-anthropic" }] }),
    1,
    now
  );
}

const SUCCESS_BODY = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  content: [{ type: "text", text: "Hi" }],
  model: "mock",
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
};

// ---------- tests ----------

describe("Retry integration", () => {
  let app: FastifyInstance;
  let db: Database.Database;

  afterEach(async () => {
    if (app) await app.close();
    if (db) db.close();
  });

  // 1. 429 -> retry -> success
  it("retries on 429 and succeeds on second attempt", async () => {
    let calls = 0;
    const { server, port } = await createMockBackend((_req, res) => {
      calls++;
      if (calls === 1) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            type: "error",
            error: { type: "rate_limit_error", message: "Too many" },
          })
        );
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(SUCCESS_BODY));
      }
    });

    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_KEY);
    setupProvider(db, `http://127.0.0.1:${port}`);
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at, retry_strategy, retry_delay_ms, max_retries, max_delay_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("rr-429", "429 rule", 429, ".*", 1, new Date().toISOString(), "exponential", 10, 2, 60000);
    const matcher = new RetryRuleMatcher();
    const container = new ServiceContainer();
    container.register("matcher", () => matcher);
    container.register("tracker", (c) => new RequestTracker({ semaphoreManager: c.resolve("semaphoreManager") }));
    container.register("usageWindowTracker", () => undefined);
    container.register("sessionTracker", () => undefined);
    container.register("adaptiveController", () => undefined);
    container.register("semaphoreManager", () => new ProviderSemaphoreManager());
    matcher.load(db);
    app = Fastify();
    app.register(anthropicProxy, { db: db, container });

    const resp = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: { "content-type": "application/json" },
      payload: {
        model: "sonnet",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 100,
      },
    });
    expect(resp.statusCode).toBe(200);
    expect(calls).toBe(2);

    const logs = db
      .prepare("SELECT * FROM request_logs ORDER BY created_at, is_retry ASC")
      .all() as any[];
    expect(logs).toHaveLength(2);
    expect(logs[0].is_retry).toBe(0);
    expect(logs[0].status_code).toBe(429);
    expect(logs[1].is_retry).toBe(1);
    expect(logs[1].original_request_id).toBe(logs[0].id);
    expect(logs[1].status_code).toBe(200);

    await closeServer(server);
  });

  // 2. 429 -> exhaust retries -> 429
  it("returns 429 after exhausting retries when backend always returns 429", async () => {
    const { server, port } = await createMockBackend((_req, res) => {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          type: "error",
          error: { type: "rate_limit_error", message: "Too many" },
        })
      );
    });

    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_KEY);
    setupProvider(db, `http://127.0.0.1:${port}`);
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at, retry_strategy, retry_delay_ms, max_retries, max_delay_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("rr-429", "429 rule", 429, ".*", 1, new Date().toISOString(), "exponential", 10, 1, 60000);
    const matcher = new RetryRuleMatcher();
    matcher.load(db);
    const container = new ServiceContainer();
    container.register("matcher", () => matcher);
    container.register("tracker", (c) => new RequestTracker({ semaphoreManager: c.resolve("semaphoreManager") }));
    container.register("usageWindowTracker", () => undefined);
    container.register("sessionTracker", () => undefined);
    container.register("adaptiveController", () => undefined);
    container.register("semaphoreManager", () => new ProviderSemaphoreManager());
    app = Fastify();
    app.register(anthropicProxy, { db: db, container });

    const resp = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: { "content-type": "application/json" },
      payload: {
        model: "sonnet",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 100,
      },
    });
    expect(resp.statusCode).toBe(429);

    const logs = db
      .prepare("SELECT * FROM request_logs ORDER BY created_at, is_retry ASC")
      .all() as any[];
    expect(logs).toHaveLength(2);
    expect(logs[0].is_retry).toBe(0);
    expect(logs[0].status_code).toBe(429);
    expect(logs[1].is_retry).toBe(1);
    expect(logs[1].original_request_id).toBe(logs[0].id);
    expect(logs[1].status_code).toBe(429);

    await closeServer(server);
  });

  // 3. Non-retryable 400 — no retry
  it("does not retry on non-retryable 400 error", async () => {
    let calls = 0;
    const { server, port } = await createMockBackend((_req, res) => {
      calls++;
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "模型不存在",
            code: "1211",
          },
        })
      );
    });

    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_KEY);
    setupProvider(db, `http://127.0.0.1:${port}`);
    const container = new ServiceContainer();
    container.register("semaphoreManager", () => new ProviderSemaphoreManager());
    container.register("tracker", (c) => new RequestTracker({ semaphoreManager: c.resolve("semaphoreManager") }));
    container.register("matcher", () => undefined);
    container.register("usageWindowTracker", () => undefined);
    container.register("sessionTracker", () => undefined);
    container.register("adaptiveController", () => undefined);
    app = Fastify();
    app.register(anthropicProxy, { db: db, container });

    const resp = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: { "content-type": "application/json" },
      payload: {
        model: "sonnet",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 100,
      },
    });
    expect(resp.statusCode).toBe(400);
    expect(calls).toBe(1);

    const logs = db
      .prepare("SELECT * FROM request_logs ORDER BY created_at")
      .all() as any[];
    expect(logs).toHaveLength(1);
    expect(logs[0].is_retry).toBe(0);
    expect(logs[0].status_code).toBe(400);

    await closeServer(server);
  });
});

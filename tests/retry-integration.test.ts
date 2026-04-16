import { describe, it, expect, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { createServer, Server, IncomingMessage, ServerResponse } from "http";
import Database from "better-sqlite3";
import { encrypt } from "../src/utils/crypto.js";
import { anthropicProxy } from "../src/proxy/anthropic.js";
import { initDatabase } from "../src/db/index.js";
import { retryableCall, buildRetryConfig } from "../src/proxy/retry.js";
import { RetryRuleMatcher } from "../src/proxy/retry-rules.js";
import type { ProxyResult } from "../src/proxy/proxy-core.js";

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
    `INSERT INTO mapping_groups (id, client_model, strategy, rule, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    "mg-sonnet",
    "sonnet",
    "scheduled",
    JSON.stringify({ default: { backend_model: "mock-model", provider_id: "svc-anthropic" } }),
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
    setupProvider(db, `http://127.0.0.1:${port}`);
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("rr-429", "429 rule", 429, ".*", 1, new Date().toISOString());
    const matcher = new RetryRuleMatcher();
    matcher.load(db);
    app = Fastify();
    app.register(anthropicProxy, {
      db,
      encryptionKey: TEST_KEY,
      streamTimeoutMs: 5000,
      retryMaxAttempts: 2,
      retryBaseDelayMs: 10,
      matcher,
    });

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
    setupProvider(db, `http://127.0.0.1:${port}`);
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("rr-429", "429 rule", 429, ".*", 1, new Date().toISOString());
    const matcher = new RetryRuleMatcher();
    matcher.load(db);
    app = Fastify();
    app.register(anthropicProxy, {
      db,
      encryptionKey: TEST_KEY,
      streamTimeoutMs: 5000,
      retryMaxAttempts: 1,
      retryBaseDelayMs: 10,
      matcher,
    });

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

  // 3. 400 retryable body -> success (direct retryableCall with RetryRuleMatcher)
  it("retries on 400 with retryable error body and succeeds on second attempt", async () => {
    db = initDatabase(":memory:");
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("rr-1", "zai-400", 400, "请稍后重试", 1, new Date().toISOString());

    const matcher = new RetryRuleMatcher();
    matcher.load(db);
    const config = buildRetryConfig(2, 10, matcher);

    let n = 0;
    const fn = (): Promise<ProxyResult> => {
      n++;
      if (n === 1) {
        return Promise.resolve({
          statusCode: 400,
          body: JSON.stringify({ error: { message: "网络错误，请稍后重试", code: "1234" } }),
          headers: {},
          sentHeaders: {},
          sentBody: "",
        });
      }
      return Promise.resolve({
        statusCode: 200,
        body: JSON.stringify({ id: "msg_1", content: "Hi" }),
        headers: {},
        sentHeaders: {},
        sentBody: "",
      });
    };

    const { result, attempts } = await retryableCall(fn, config);
    expect(result.statusCode).toBe(200);
    expect(attempts).toHaveLength(2);
    expect(attempts[0].statusCode).toBe(400);
    expect(attempts[1].statusCode).toBe(200);
  });

  // 4. Non-retryable 400 — no retry
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
    setupProvider(db, `http://127.0.0.1:${port}`);
    app = Fastify();
    app.register(anthropicProxy, {
      db,
      encryptionKey: TEST_KEY,
      streamTimeoutMs: 5000,
      retryMaxAttempts: 2,
      retryBaseDelayMs: 10,
    });

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

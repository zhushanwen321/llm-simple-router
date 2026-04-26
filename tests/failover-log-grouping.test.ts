import { describe, it, expect, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { createServer, Server, IncomingMessage, ServerResponse } from "http";
import Database from "better-sqlite3";
import { createHash } from "crypto";
import { encrypt } from "../src/utils/crypto.js";
import { openaiProxy } from "../src/proxy/openai.js";
import { authMiddleware } from "../src/middleware/auth.js";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { RetryRuleMatcher } from "../src/proxy/retry-rules.js";
import { ProviderSemaphoreManager } from "../src/proxy/semaphore.js";
import { RequestTracker } from "../src/monitor/request-tracker.js";

const API_KEY = "sk-test-router";
const API_KEY_HASH = createHash("sha256").update(API_KEY).digest("hex");
const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const SUCCESS_BODY = {
  id: "chatcmpl-1",
  object: "chat.completion",
  model: "gpt-4",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Hi" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

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

function setupFailoverGroup(
  db: Database.Database,
  url1: string,
  url2: string
) {
  const now = new Date().toISOString();
  const encryptedKey = encrypt("sk-test-key", TEST_ENCRYPTION_KEY);

  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "prov-primary",
    "Primary",
    "openai",
    url1,
    encryptedKey,
    1,
    now,
    now
  );

  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "prov-fallback",
    "Fallback",
    "openai",
    url2,
    encryptedKey,
    1,
    now,
    now
  );

  db.prepare(
    `INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    "mg-failover",
    "gpt-4",
    JSON.stringify({
      targets: [
        { backend_model: "gpt-4", provider_id: "prov-primary" },
        { backend_model: "gpt-4", provider_id: "prov-fallback" },
      ],
    }),
    1,
    now
  );

  db.prepare(
    "INSERT INTO router_keys (id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?)"
  ).run("test-router-key", "Test Key", API_KEY_HASH, API_KEY.slice(0, 8));
}

describe("Failover log grouping", () => {
  let app: FastifyInstance;
  let db: Database.Database;
  const servers: Server[] = [];

  afterEach(async () => {
    if (app) await app.close();
    for (const s of servers) await closeServer(s);
    servers.length = 0;
    if (db) db.close();
  });

  it("associates failover requests with original_request_id and is_failover flag", async () => {
    const { server: primaryServer, port: primaryPort } =
      await createMockBackend((_req, res) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: { message: "Internal Server Error", type: "server_error" },
          })
        );
      });
    servers.push(primaryServer);

    const { server: fallbackServer, port: fallbackPort } =
      await createMockBackend((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(SUCCESS_BODY));
      });
    servers.push(fallbackServer);

    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
    setSetting(db, "initialized", "true");
    setupFailoverGroup(
      db,
      `http://127.0.0.1:${primaryPort}`,
      `http://127.0.0.1:${fallbackPort}`
    );

    app = Fastify();
    app.register(authMiddleware, { db });
    app.register(openaiProxy, {
      db,
      streamTimeoutMs: 5000,
      retryBaseDelayMs: 0,
      semaphoreManager: new ProviderSemaphoreManager(),
      tracker: new RequestTracker({ semaphoreManager: new ProviderSemaphoreManager() }),
    });

    const resp = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${API_KEY}`,
      },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
      },
    });
    expect(resp.statusCode).toBe(200);

    const logs = db
      .prepare("SELECT id, status_code, is_failover, is_retry, original_request_id FROM request_logs ORDER BY rowid ASC")
      .all() as any[];
    expect(logs).toHaveLength(2);

    // 原始请求 → primary 返回 500
    expect(logs[0].status_code).toBe(500);
    expect(logs[0].is_failover).toBe(0);
    expect(logs[0].is_retry).toBe(0);
    expect(logs[0].original_request_id).toBeNull();

    // Failover 请求 → fallback 返回 200，关联到原始请求
    expect(logs[1].status_code).toBe(200);
    expect(logs[1].is_failover).toBe(1);
    expect(logs[1].is_retry).toBe(0);
    expect(logs[1].original_request_id).toBe(logs[0].id);
  });

  it("streaming failover: primary returns 500, fallback streams successfully", async () => {
    const SSE_CHUNKS = [
      `data: ${JSON.stringify({
        id: "chatcmpl-stream",
        object: "chat.completion.chunk",
        choices: [{ delta: { content: "Hi" } }],
      })}\n\n`,
      `data: ${JSON.stringify({
        id: "chatcmpl-stream",
        object: "chat.completion.chunk",
        choices: [{ delta: { content: "!" } }],
      })}\n\n`,
      "data: [DONE]\n\n",
    ];

    const { server: primaryServer, port: primaryPort } =
      await createMockBackend((_req, res) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: { message: "Internal Server Error", type: "server_error" },
          })
        );
      });
    servers.push(primaryServer);

    const { server: fallbackServer, port: fallbackPort } =
      await createMockBackend((_req, res) => {
        let body = "";
        _req.on("data", (chunk) => (body += chunk));
        _req.on("end", () => {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          for (const chunk of SSE_CHUNKS) {
            res.write(chunk);
          }
          res.end();
        });
      });
    servers.push(fallbackServer);

    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
    setSetting(db, "initialized", "true");
    setupFailoverGroup(
      db,
      `http://127.0.0.1:${primaryPort}`,
      `http://127.0.0.1:${fallbackPort}`
    );

    app = Fastify();
    app.register(authMiddleware, { db });
    app.register(openaiProxy, {
      db,
      streamTimeoutMs: 5000,
      retryBaseDelayMs: 0,
      semaphoreManager: new ProviderSemaphoreManager(),
      tracker: new RequestTracker({ semaphoreManager: new ProviderSemaphoreManager() }),
    });

    const resp = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${API_KEY}`,
      },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
        stream: true,
      },
    });
    expect(resp.statusCode).toBe(200);
    // 验证流式内容被正确转发
    expect(resp.body).toContain("data: [DONE]");

    const logs = db
      .prepare("SELECT id, status_code, is_failover, is_retry, original_request_id, is_stream FROM request_logs ORDER BY rowid ASC")
      .all() as any[];
    expect(logs).toHaveLength(2);

    // 原始请求 → primary 返回 500（流式请求上游返回非200时，走错误收集路径）
    expect(logs[0].status_code).toBe(500);
    expect(logs[0].is_failover).toBe(0);
    expect(logs[0].is_retry).toBe(0);
    expect(logs[0].is_stream).toBe(1);
    expect(logs[0].original_request_id).toBeNull();

    // Failover 请求 → fallback 返回 200 流式响应
    expect(logs[1].status_code).toBe(200);
    expect(logs[1].is_failover).toBe(1);
    expect(logs[1].is_retry).toBe(0);
    expect(logs[1].is_stream).toBe(1);
    expect(logs[1].original_request_id).toBe(logs[0].id);
  });

  it("all failover targets fail — all logs still associated", async () => {
    const { server: primaryServer, port: primaryPort } =
      await createMockBackend((_req, res) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: { message: "Internal Server Error", type: "server_error" },
          })
        );
      });
    servers.push(primaryServer);

    const { server: fallbackServer, port: fallbackPort } =
      await createMockBackend((_req, res) => {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: { message: "Bad Gateway", type: "server_error" },
          })
        );
      });
    servers.push(fallbackServer);

    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
    setSetting(db, "initialized", "true");
    setupFailoverGroup(
      db,
      `http://127.0.0.1:${primaryPort}`,
      `http://127.0.0.1:${fallbackPort}`
    );

    app = Fastify();
    app.register(authMiddleware, { db });
    app.register(openaiProxy, {
      db,
      streamTimeoutMs: 5000,
      retryBaseDelayMs: 0,
      semaphoreManager: new ProviderSemaphoreManager(),
      tracker: new RequestTracker({ semaphoreManager: new ProviderSemaphoreManager() }),
    });

    const resp = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${API_KEY}`,
      },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
      },
    });
    // 最后一个 target 返回 502
    expect(resp.statusCode).toBe(502);

    const logs = db
      .prepare("SELECT id, status_code, is_failover, is_retry, original_request_id, provider_id, created_at FROM request_logs ORDER BY rowid ASC")
      .all() as any[];
    expect(logs).toHaveLength(3);

    // 原始请求 → primary 返回 500
    expect(logs[0].status_code).toBe(500);
    expect(logs[0].is_failover).toBe(0);
    expect(logs[0].is_retry).toBe(0);
    expect(logs[0].original_request_id).toBeNull();

    // Failover 请求 → fallback 返回 502，关联到原始请求
    expect(logs[1].status_code).toBe(502);
    expect(logs[1].is_failover).toBe(1);
    expect(logs[1].is_retry).toBe(0);
    expect(logs[1].original_request_id).toBe(logs[0].id);

    // 所有 failover 目标耗尽的最终失败日志
    expect(logs[2].status_code).toBe(502);
    expect(logs[2].is_failover).toBe(1);
    expect(logs[2].is_retry).toBe(0);
    expect(logs[2].original_request_id).toBe(logs[0].id);
    expect(logs[2].provider_id).toBeNull();
  });

  it("retry+failover: primary retriable error exhausts retries, failover to fallback succeeds", async () => {
    let primaryCalls = 0;
    const { server: primaryServer, port: primaryPort } =
      await createMockBackend((_req, res) => {
        primaryCalls++;
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: { message: "Too Many Requests", type: "rate_limit_error" },
          })
        );
      });
    servers.push(primaryServer);

    const { server: fallbackServer, port: fallbackPort } =
      await createMockBackend((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(SUCCESS_BODY));
      });
    servers.push(fallbackServer);

    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
    setSetting(db, "initialized", "true");
    setupFailoverGroup(
      db,
      `http://127.0.0.1:${primaryPort}`,
      `http://127.0.0.1:${fallbackPort}`
    );

    // 插入 429 重试规则，max_retries=1 允许重试 1 次（共 2 次调用）
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at, retry_strategy, retry_delay_ms, max_retries, max_delay_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("rr-429", "429 rule", 429, ".*", 1, new Date().toISOString(), "exponential", 10, 1, 60000);

    const matcher = new RetryRuleMatcher();
    matcher.load(db);

    app = Fastify();
    app.register(authMiddleware, { db });
    app.register(openaiProxy, {
      db,
      streamTimeoutMs: 5000,
      retryBaseDelayMs: 10,
      matcher,
      semaphoreManager: new ProviderSemaphoreManager(),
      tracker: new RequestTracker({ semaphoreManager: new ProviderSemaphoreManager() }),
    });

    const resp = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${API_KEY}`,
      },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
      },
    });

    // 最终请求成功（failover 到 Provider B）
    expect(resp.statusCode).toBe(200);
    // Provider A 被调用了 2 次：首次 + 1 次重试
    expect(primaryCalls).toBe(2);

    const logs = db
      .prepare("SELECT id, status_code, is_failover, is_retry, original_request_id, provider_id FROM request_logs ORDER BY rowid ASC")
      .all() as any[];

    // 共 3 条日志：Provider A 首次 + Provider A 重试 + Provider B 成功
    expect(logs).toHaveLength(3);

    // Provider A 首次请求（429）
    expect(logs[0].status_code).toBe(429);
    expect(logs[0].is_retry).toBe(0);
    expect(logs[0].is_failover).toBe(0);
    expect(logs[0].original_request_id).toBeNull();
    expect(logs[0].provider_id).toBe("prov-primary");

    // Provider A 重试请求（429），original_request_id 指向当前 iteration 的 logId
    expect(logs[1].status_code).toBe(429);
    expect(logs[1].is_retry).toBe(1);
    expect(logs[1].is_failover).toBe(0);
    expect(logs[1].original_request_id).toBe(logs[0].id);
    expect(logs[1].provider_id).toBe("prov-primary");

    // Provider B 成功请求（failover）
    expect(logs[2].status_code).toBe(200);
    expect(logs[2].is_retry).toBe(0);
    expect(logs[2].is_failover).toBe(1);
    expect(logs[2].original_request_id).toBe(logs[0].id);
    expect(logs[2].provider_id).toBe("prov-fallback");
  });
});

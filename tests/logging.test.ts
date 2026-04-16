import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import {
  createServer,
  Server,
  IncomingMessage,
  ServerResponse,
} from "http";
import Database from "better-sqlite3";
import { createHash } from "crypto";
import { openaiProxy } from "../src/proxy/openai.js";
import { anthropicProxy } from "../src/proxy/anthropic.js";
import { authMiddleware } from "../src/middleware/auth.js";
import { encrypt } from "../src/utils/crypto.js";
import { initDatabase } from "../src/db/index.js";

const API_KEY = "sk-test-router";
const API_KEY_HASH = createHash("sha256").update(API_KEY).digest("hex");
const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// 启动 mock 后端 HTTP 服务器
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

function createApp() {
  const db = initDatabase(":memory:");

  // 插入测试用的 router key，使 auth middleware 能通过认证
  db.prepare(
    "INSERT INTO router_keys (id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?)"
  ).run("test-router-key", "Test Key", API_KEY_HASH, API_KEY.slice(0, 8));

  const app = Fastify();
  app.register(authMiddleware, { db });
  app.register(openaiProxy, {
    db,
    encryptionKey: TEST_ENCRYPTION_KEY,
    streamTimeoutMs: 5000,
    retryMaxAttempts: 0,
    retryBaseDelayMs: 0,
  });
  app.register(anthropicProxy, {
    db,
    encryptionKey: TEST_ENCRYPTION_KEY,
    streamTimeoutMs: 5000,
    retryMaxAttempts: 0,
    retryBaseDelayMs: 0,
  });

  return { app, db };
}

function insertOpenAIBackend(db: Database.Database, port: number) {
  const now = new Date().toISOString();
  const encryptedKey = encrypt("sk-backend", TEST_ENCRYPTION_KEY);
  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "svc-o1",
    "Mock OpenAI",
    "openai",
    `http://127.0.0.1:${port}`,
    encryptedKey,
    1,
    now,
    now
  );
  // gpt-4 映射到 provider
  db.prepare(
    `INSERT INTO model_mappings (id, client_model, backend_model, provider_id, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run("map-o1", "gpt-4", "gpt-4-turbo", "svc-o1", 1, now);
  db.prepare(
    `INSERT INTO mapping_groups (id, client_model, strategy, rule, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    "mg-o1",
    "gpt-4",
    "scheduled",
    JSON.stringify({ default: { backend_model: "gpt-4-turbo", provider_id: "svc-o1" } }),
    now
  );
}

function insertAnthropicBackend(db: Database.Database, port: number) {
  const now = new Date().toISOString();
  const encryptedKey = encrypt("sk-backend", TEST_ENCRYPTION_KEY);
  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "svc-a1",
    "Mock Anthropic",
    "anthropic",
    `http://127.0.0.1:${port}`,
    encryptedKey,
    1,
    now,
    now
  );
  // claude-3-sonnet 映射到 provider
  db.prepare(
    `INSERT INTO model_mappings (id, client_model, backend_model, provider_id, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run("map-a1", "claude-3-sonnet", "claude-3-sonnet", "svc-a1", 1, now);
  db.prepare(
    `INSERT INTO mapping_groups (id, client_model, strategy, rule, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    "mg-a1",
    "claude-3-sonnet",
    "scheduled",
    JSON.stringify({ default: { backend_model: "claude-3-sonnet", provider_id: "svc-a1" } }),
    now
  );
}

function getRequestLogs(db: Database.Database) {
  return db
    .prepare("SELECT * FROM request_logs ORDER BY created_at")
    .all() as any[];
}

describe("Request logging", () => {
  let mockServer: Server;
  let mockPort: number;

  beforeEach(async () => {
    const result = await createMockBackend((req, res) => {
      // OpenAI chat completions
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          const parsed = JSON.parse(body);
          if (parsed.stream) {
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            });
            res.write(
              'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hi"}}]}\n\n'
            );
            res.write("data: [DONE]\n\n");
            res.end();
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                id: "chatcmpl-1",
                object: "chat.completion",
                choices: [
                  {
                    message: { role: "assistant", content: "Hello" },
                  },
                ],
                model: parsed.model,
              })
            );
          }
        });
      }
      // Anthropic messages
      else if (req.method === "POST" && req.url === "/v1/messages") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          const parsed = JSON.parse(body);
          if (parsed.stream) {
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            });
            res.write(
              'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-1"}}\n\n'
            );
            res.write(
              'event: message_stop\ndata: {"type":"message_stop"}\n\n'
            );
            res.end();
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                id: "msg-1",
                type: "message",
                role: "assistant",
                content: [{ type: "text", text: "Hello from Claude" }],
                model: parsed.model,
              })
            );
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    mockServer = result.server;
    mockPort = result.port;
  });

  afterEach(async () => {
    await closeServer(mockServer);
  });

  it("should log successful OpenAI non-stream request to DB", async () => {
    const { app, db } = createApp();
    try {
      insertOpenAIBackend(db, mockPort);

      await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: {
          authorization: `Bearer ${API_KEY}`,
          "content-type": "application/json",
        },
        payload: {
          model: "gpt-4",
          messages: [{ role: "user", content: "hi" }],
        },
      });

      const logs = getRequestLogs(db);
      expect(logs.length).toBe(1);
      expect(logs[0].api_type).toBe("openai");
      expect(logs[0].model).toBe("gpt-4");
      expect(logs[0].provider_id).toBe("svc-o1");
      expect(logs[0].status_code).toBe(200);
      expect(logs[0].latency_ms).toBeGreaterThanOrEqual(0);
      expect(logs[0].is_stream).toBe(0);
      expect(logs[0].error_message).toBeNull();
    } finally {
      await app.close();
      db.close();
    }
  });

  it("should log failed request (backend error) to DB", async () => {
    const { app, db } = createApp();
    try {
      const now = new Date().toISOString();
      const encryptedKey = encrypt("sk-key", TEST_ENCRYPTION_KEY);
      db.prepare(
        `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        "svc-bad",
        "Bad Backend",
        "openai",
        "http://127.0.0.1:1",
        encryptedKey,
        1,
        now,
        now
      );
      db.prepare(
        `INSERT INTO model_mappings (id, client_model, backend_model, provider_id, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run("map-bad", "gpt-4", "gpt-4-turbo", "svc-bad", 1, now);
      db.prepare(
        `INSERT INTO mapping_groups (id, client_model, strategy, rule, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        "mg-bad",
        "gpt-4",
        "scheduled",
        JSON.stringify({ default: { backend_model: "gpt-4-turbo", provider_id: "svc-bad" } }),
        now
      );

      await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: {
          authorization: `Bearer ${API_KEY}`,
          "content-type": "application/json",
        },
        payload: {
          model: "gpt-4",
          messages: [{ role: "user", content: "hi" }],
        },
      });

      const logs = getRequestLogs(db);
      expect(logs.length).toBe(1);
      expect(logs[0].status_code).toBe(502);
      expect(logs[0].error_message).toBeTruthy();
    } finally {
      await app.close();
      db.close();
    }
  });

  it("should mark stream requests with is_stream=1", async () => {
    const { app, db } = createApp();
    try {
      insertOpenAIBackend(db, mockPort);

      await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: {
          authorization: `Bearer ${API_KEY}`,
          "content-type": "application/json",
        },
        payload: {
          model: "gpt-4",
          messages: [{ role: "user", content: "hi" }],
          stream: true,
        },
      });

      const logs = getRequestLogs(db);
      expect(logs.length).toBe(1);
      expect(logs[0].is_stream).toBe(1);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("should record correct latency_ms", async () => {
    const { app, db } = createApp();
    try {
      insertOpenAIBackend(db, mockPort);

      await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: {
          authorization: `Bearer ${API_KEY}`,
          "content-type": "application/json",
        },
        payload: {
          model: "gpt-4",
          messages: [{ role: "user", content: "hi" }],
        },
      });

      const logs = getRequestLogs(db);
      expect(logs[0].latency_ms).toBeGreaterThanOrEqual(0);
      expect(logs[0].latency_ms).toBeLessThan(10000);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("should log Anthropic requests with correct api_type", async () => {
    const { app, db } = createApp();
    try {
      insertAnthropicBackend(db, mockPort);

      await app.inject({
        method: "POST",
        url: "/v1/messages",
        headers: {
          authorization: `Bearer ${API_KEY}`,
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        payload: {
          model: "claude-3-sonnet",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 100,
        },
      });

      const logs = getRequestLogs(db);
      expect(logs.length).toBe(1);
      expect(logs[0].api_type).toBe("anthropic");
      expect(logs[0].model).toBe("claude-3-sonnet");
    } finally {
      await app.close();
      db.close();
    }
  });
});

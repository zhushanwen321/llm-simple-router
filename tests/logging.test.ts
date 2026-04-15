import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import {
  createServer,
  Server,
  IncomingMessage,
  ServerResponse,
} from "http";
import Database from "better-sqlite3";
import { openaiProxy } from "../src/proxy/openai.js";
import { anthropicProxy } from "../src/proxy/anthropic.js";
import { authMiddleware } from "../src/middleware/auth.js";
import { encrypt } from "../src/utils/crypto.js";

const API_KEY = "sk-test-router";
const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// 创建内存数据库并建表
function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS backend_services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_type TEXT NOT NULL CHECK(api_type IN ('openai', 'anthropic')),
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_mappings (
      id TEXT PRIMARY KEY,
      client_model TEXT NOT NULL UNIQUE,
      backend_model TEXT NOT NULL,
      backend_service_id TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (backend_service_id) REFERENCES backend_services(id)
    );
    CREATE TABLE IF NOT EXISTS request_logs (
      id TEXT PRIMARY KEY,
      api_type TEXT NOT NULL,
      model TEXT,
      backend_service_id TEXT,
      status_code INTEGER,
      latency_ms INTEGER,
      is_stream INTEGER,
      error_message TEXT,
      created_at TEXT NOT NULL,
      request_body TEXT,
      response_body TEXT,
      client_request TEXT,
      upstream_request TEXT,
      upstream_response TEXT,
      client_response TEXT
    );
  `);
  return db;
}

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
  const db = createTestDb();

  const app = Fastify();
  app.register(authMiddleware, { apiKey: API_KEY });
  app.register(openaiProxy, {
    db,
    encryptionKey: TEST_ENCRYPTION_KEY,
    streamTimeoutMs: 5000,
  });
  app.register(anthropicProxy, {
    db,
    encryptionKey: TEST_ENCRYPTION_KEY,
    streamTimeoutMs: 5000,
  });

  return { app, db };
}

function insertOpenAIBackend(db: Database.Database, port: number) {
  const now = new Date().toISOString();
  const encryptedKey = encrypt("sk-backend", TEST_ENCRYPTION_KEY);
  db.prepare(
    `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
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
}

function insertAnthropicBackend(db: Database.Database, port: number) {
  const now = new Date().toISOString();
  const encryptedKey = encrypt("sk-backend", TEST_ENCRYPTION_KEY);
  db.prepare(
    `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
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
      expect(logs[0].backend_service_id).toBe("svc-o1");
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
        `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
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

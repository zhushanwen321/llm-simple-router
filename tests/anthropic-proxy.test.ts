import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { createServer, Server, IncomingMessage, ServerResponse } from "http";
import Database from "better-sqlite3";
import { encrypt } from "../src/utils/crypto.js";
import { anthropicProxy } from "../src/proxy/anthropic.js";

const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// ---------- 辅助工具 ----------

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

function buildTestApp(mockDb: Database.Database): FastifyInstance {
  const app = Fastify();

  app.register(anthropicProxy, {
    db: mockDb,
    encryptionKey: TEST_ENCRYPTION_KEY,
    streamTimeoutMs: 5000,
  });

  return app;
}

async function sendRequest(
  app: FastifyInstance,
  body: Record<string, unknown>
) {
  return app.inject({
    method: "POST",
    url: "/v1/messages",
    headers: { "content-type": "application/json" },
    payload: body,
  });
}

// ---------- mock 数据 ----------

const ANTHROPIC_NON_STREAM_RESPONSE = {
  id: "msg_test",
  type: "message",
  role: "assistant",
  content: [{ type: "text", text: "Hello!" }],
  model: "claude-3-opus-20240229",
  stop_reason: "end_turn",
  usage: { input_tokens: 10, output_tokens: 2 },
};

const ANTHROPIC_SSE_EVENTS = [
  {
    event: "message_start",
    data: JSON.stringify({
      type: "message_start",
      message: {
        id: "msg_test",
        type: "message",
        role: "assistant",
        content: [],
      },
    }),
  },
  {
    event: "content_block_start",
    data: JSON.stringify({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }),
  },
  {
    event: "content_block_delta",
    data: JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hi" },
    }),
  },
  {
    event: "content_block_delta",
    data: JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "!" },
    }),
  },
  {
    event: "content_block_stop",
    data: JSON.stringify({ type: "content_block_stop", index: 0 }),
  },
  {
    event: "message_stop",
    data: JSON.stringify({ type: "message_stop" }),
  },
];

function formatSSE(events: { event: string; data: string }[]): string {
  return events.map((e) => `event: ${e.event}\ndata: ${e.data}\n\n`).join("");
}

function insertMockBackend(
  mockDb: Database.Database,
  baseUrl: string
): void {
  const now = new Date().toISOString();
  const encryptedKey = encrypt("sk-ant-backend-key", TEST_ENCRYPTION_KEY);
  mockDb
    .prepare(
      `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "svc-anthropic",
      "MockAnthropic",
      "anthropic",
      baseUrl,
      encryptedKey,
      1,
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
      `INSERT INTO model_mappings (id, client_model, backend_model, backend_service_id, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run("map-a1", clientModel, backendModel, "svc-anthropic", 1, now);
}

// ---------- 测试 ----------

describe("Anthropic proxy", () => {
  let app: FastifyInstance;
  let mockDb: Database.Database;

  beforeEach(() => {
    mockDb = createTestDb();
  });

  afterEach(async () => {
    if (app) await app.close();
    if (mockDb) mockDb.close();
  });

  // 1. 非流式请求透传
  it("should proxy non-stream request and return response", async () => {
    const { server: backendServer, port } = await createMockBackend(
      (req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(ANTHROPIC_NON_STREAM_RESPONSE));
        });
      }
    );

    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);

    app = buildTestApp(mockDb);
    const response = await sendRequest(app, {
      model: "claude-3-opus-20240229",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1024,
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.id).toBe("msg_test");
    expect(json.type).toBe("message");
    expect(json.content[0].text).toBe("Hello!");

    await closeServer(backendServer);
  });

  // 2. SSE 流式透传
  it("should proxy SSE stream request and forward Anthropic events", async () => {
    const sseBody = formatSSE(ANTHROPIC_SSE_EVENTS);

    const { server: backendServer, port } = await createMockBackend(
      (req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          res.write(sseBody);
          res.end();
        });
      }
    );

    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);

    app = buildTestApp(mockDb);
    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: { "content-type": "application/json" },
      payload: {
        model: "claude-3-opus-20240229",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1024,
        stream: true,
      },
    });

    expect(response.statusCode).toBe(200);
    const responseBody = response.body;

    for (const evt of ANTHROPIC_SSE_EVENTS) {
      expect(responseBody).toContain(`event: ${evt.event}`);
      expect(responseBody).toContain(`data: ${evt.data}`);
    }

    await closeServer(backendServer);
  });

  // 3. 模型映射替换
  it("should replace model name when mapping exists", async () => {
    let receivedBody: string = "";

    const { server: backendServer, port } = await createMockBackend(
      (req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          receivedBody = body;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(ANTHROPIC_NON_STREAM_RESPONSE));
        });
      }
    );

    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);
    insertModelMapping(mockDb, "claude-3", "claude-3-opus-20240229");

    app = buildTestApp(mockDb);
    await sendRequest(app, {
      model: "claude-3",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1024,
    });

    const parsed = JSON.parse(receivedBody);
    expect(parsed.model).toBe("claude-3-opus-20240229");

    await closeServer(backendServer);
  });

  // 4. 模型无映射透传
  it("should keep original model when no mapping exists", async () => {
    let receivedBody: string = "";

    const { server: backendServer, port } = await createMockBackend(
      (req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          receivedBody = body;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(ANTHROPIC_NON_STREAM_RESPONSE));
        });
      }
    );

    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);

    app = buildTestApp(mockDb);
    await sendRequest(app, {
      model: "claude-3-sonnet-20240229",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1024,
    });

    const parsed = JSON.parse(receivedBody);
    expect(parsed.model).toBe("claude-3-sonnet-20240229");

    await closeServer(backendServer);
  });

  // 5. 后端不可达 - 502
  it("should return 502 when backend is unreachable", async () => {
    insertMockBackend(mockDb, "http://127.0.0.1:19999");

    app = buildTestApp(mockDb);
    const response = await sendRequest(app, {
      model: "claude-3-opus-20240229",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1024,
    });

    expect(response.statusCode).toBe(502);
    const json = response.json();
    expect(json.error).toBeDefined();
    expect(json.error.type).toBe("upstream_error");
  });

  // 6. 后端错误透传
  it("should proxy backend error status code and body", async () => {
    const { server: backendServer, port } = await createMockBackend(
      (req, res) => {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            type: "error",
            error: {
              type: "rate_limit_error",
              message: "This request would exceed the rate limit.",
            },
          })
        );
      }
    );

    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);

    app = buildTestApp(mockDb);
    const response = await sendRequest(app, {
      model: "claude-3-opus-20240229",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1024,
    });

    expect(response.statusCode).toBe(429);
    const json = response.json();
    expect(json.type).toBe("error");
    expect(json.error.type).toBe("rate_limit_error");
    expect(json.error.message).toContain("rate limit");

    await closeServer(backendServer);
  });

  // 7. 无后端服务 - 404
  it("should return 404 when no active backend service found", async () => {
    app = buildTestApp(mockDb);
    const response = await sendRequest(app, {
      model: "claude-3-opus-20240229",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1024,
    });

    expect(response.statusCode).toBe(404);
    const json = response.json();
    expect(json.type).toBe("error");
    expect(json.error.type).toBe("invalid_request_error");
  });
});

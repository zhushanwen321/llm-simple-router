import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { createServer, Server, IncomingMessage, ServerResponse } from "http";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { encrypt } from "../src/utils/crypto.js";
import { openaiProxy } from "../src/proxy/openai.js";

// 测试用 32 字节密钥（64 hex chars）
const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// ---------- 辅助工具 ----------

// 创建内存数据库并执行迁移
function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  initDatabase(":memory:");
  // 直接在当前连接上执行迁移 SQL
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

// 启动一个 mock 后端 HTTP 服务器，使用动态端口
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

  app.register(openaiProxy, {
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
    url: "/v1/chat/completions",
    headers: { "content-type": "application/json" },
    payload: body,
  });
}

// ---------- mock 数据 ----------

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

const OPENAI_SSE_CHUNKS = [
  `data: ${JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    choices: [{ delta: { content: "Hi" } }],
  })}\n\n`,
  `data: ${JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    choices: [{ delta: { content: "!" } }],
  })}\n\n`,
  "data: [DONE]\n\n",
];

// ---------- 插入 mock 后端数据的工具 ----------

function insertMockBackend(
  mockDb: Database.Database,
  baseUrl: string
): void {
  const now = new Date().toISOString();
  const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);
  mockDb
    .prepare(
      `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "svc-openai",
      "MockOpenAI",
      "openai",
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
    .run("map-1", clientModel, backendModel, "svc-openai", 1, now);
}

// ---------- 测试 ----------

describe("OpenAI proxy", () => {
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
          res.end(JSON.stringify(OPENAI_NON_STREAM_RESPONSE));
        });
      }
    );

    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);

    app = buildTestApp(mockDb);
    const response = await sendRequest(app, {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.id).toBe("chatcmpl-test");
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.content).toBe("Hello!");

    await closeServer(backendServer);
  });

  // 2. SSE 流式透传
  it("should proxy SSE stream request and forward chunks", async () => {
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
          for (const chunk of OPENAI_SSE_CHUNKS) {
            res.write(chunk);
          }
          res.end();
        });
      }
    );

    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);

    app = buildTestApp(mockDb);
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
        stream: true,
      },
    });

    expect(response.statusCode).toBe(200);
    const responseBody = response.body;
    // 验证每个 SSE chunk 都被转发
    for (const chunk of OPENAI_SSE_CHUNKS) {
      expect(responseBody).toContain(chunk.trim());
    }
    // 验证 [DONE] 结束标记
    expect(responseBody).toContain("data: [DONE]");

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
          res.end(JSON.stringify(OPENAI_NON_STREAM_RESPONSE));
        });
      }
    );

    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);
    insertModelMapping(mockDb, "gpt-4", "gpt-4-turbo");

    app = buildTestApp(mockDb);
    await sendRequest(app, {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hi" }],
    });

    // 验证转发到后端的 body 中 model 被替换为 gpt-4-turbo
    const parsed = JSON.parse(receivedBody);
    expect(parsed.model).toBe("gpt-4-turbo");

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
          res.end(JSON.stringify(OPENAI_NON_STREAM_RESPONSE));
        });
      }
    );

    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);

    // 不插入映射，model 应原样透传
    app = buildTestApp(mockDb);
    await sendRequest(app, {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
    });

    const parsed = JSON.parse(receivedBody);
    expect(parsed.model).toBe("gpt-4o");

    await closeServer(backendServer);
  });

  // 5. 后端不可达 - 返回 502
  it("should return 502 when backend is unreachable", async () => {
    // 指向一个不存在的端口
    insertMockBackend(mockDb, "http://127.0.0.1:19999");

    app = buildTestApp(mockDb);
    const response = await sendRequest(app, {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.statusCode).toBe(502);
    const json = response.json();
    expect(json.error).toBeDefined();
    expect(json.error.type).toBe("upstream_error");
  });

  // 6. 后端错误透传 - 429
  it("should proxy backend error status code and body", async () => {
    const { server: backendServer, port } = await createMockBackend(
      (req, res) => {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message: "Rate limit exceeded",
              type: "rate_limit_error",
              code: "rate_limit_exceeded",
            },
          })
        );
      }
    );

    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);

    app = buildTestApp(mockDb);
    const response = await sendRequest(app, {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.statusCode).toBe(429);
    const json = response.json();
    expect(json.error.message).toBe("Rate limit exceeded");
    expect(json.error.type).toBe("rate_limit_error");

    await closeServer(backendServer);
  });

  // 7. 无后端服务 - 返回 404
  it("should return 404 when no active backend service found", async () => {
    // 不插入任何后端服务
    app = buildTestApp(mockDb);
    const response = await sendRequest(app, {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.statusCode).toBe(404);
    const json = response.json();
    expect(json.error).toBeDefined();
    expect(json.error.type).toBe("invalid_request_error");
    expect(json.error.code).toBe("model_not_found");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import {
  createServer,
  Server,
  IncomingMessage,
  ServerResponse,
} from "http";
import Database from "better-sqlite3";
import { buildApp } from "../src/index.js";
import { encrypt } from "../src/utils/crypto.js";

const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const API_KEY = "sk-integration-test";

function makeTestConfig() {
  return {
    ROUTER_API_KEY: API_KEY,
    ADMIN_PASSWORD: "admin123",
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    PORT: 3000,
    DB_PATH: ":memory:",
    LOG_LEVEL: "silent",
    TZ: "Asia/Shanghai",
    STREAM_TIMEOUT_MS: 5000,
  };
}

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS providers (
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
      provider_id TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (provider_id) REFERENCES providers(id)
    );
    CREATE TABLE IF NOT EXISTS request_logs (
      id TEXT PRIMARY KEY,
      api_type TEXT NOT NULL,
      model TEXT,
      provider_id TEXT,
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

describe("Integration tests", () => {
  let mockOpenAI: { server: Server; port: number };
  let mockAnthropic: { server: Server; port: number };
  let db: Database.Database;
  let app: FastifyInstance;
  let close: () => Promise<void>;

  beforeEach(async () => {
    process.env.ROUTER_API_KEY = API_KEY;
    process.env.ADMIN_PASSWORD = "admin123";
    process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
    process.env.LOG_LEVEL = "silent";

    db = createTestDb();

    // Mock OpenAI 后端
    mockOpenAI = await createMockBackend((req, res) => {
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
              'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"}}]}\n\n'
            );
            res.write(
              'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"delta":{"content":" world"}}]}\n\n'
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
                    index: 0,
                    message: {
                      role: "assistant",
                      content: "Hello! How can I help?",
                    },
                    finish_reason: "stop",
                  },
                ],
                usage: {
                  prompt_tokens: 10,
                  completion_tokens: 5,
                  total_tokens: 15,
                },
                model: parsed.model,
              })
            );
          }
        });
      } else if (req.method === "GET" && req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            object: "list",
            data: [
              {
                id: "gpt-4",
                object: "model",
                created: 1687882411,
                owned_by: "openai",
              },
              {
                id: "gpt-3.5-turbo",
                object: "model",
                created: 1677610602,
                owned_by: "openai",
              },
            ],
          })
        );
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    // Mock Anthropic 后端
    mockAnthropic = await createMockBackend((req, res) => {
      if (req.method === "POST" && req.url === "/v1/messages") {
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
              'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-1","role":"assistant"}}\n\n'
            );
            res.write(
              'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n'
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
                usage: { input_tokens: 10, output_tokens: 5 },
              })
            );
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    const config = makeTestConfig();
    const result = await buildApp({ config, db });
    app = result.app;
    close = result.close;

    // 插入后端服务（api_key 需要加密存储）
    const now = new Date().toISOString();
    const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);

    db.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "svc-openai",
      "Mock OpenAI",
      "openai",
      `http://127.0.0.1:${mockOpenAI.port}`,
      encryptedKey,
      1,
      now,
      now
    );

    db.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "svc-anthropic",
      "Mock Anthropic",
      "anthropic",
      `http://127.0.0.1:${mockAnthropic.port}`,
      encryptedKey,
      1,
      now,
      now
    );

    // 插入默认模型映射，使代理能路由请求
    db.prepare(
      `INSERT INTO model_mappings (id, client_model, backend_model, provider_id, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("map-gpt4", "gpt-4", "gpt-4", "svc-openai", 1, now);

    db.prepare(
      `INSERT INTO model_mappings (id, client_model, backend_model, provider_id, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("map-claude3", "claude-3-sonnet", "claude-3-sonnet", "svc-anthropic", 1, now);
  });

  afterEach(async () => {
    await close();
    await closeServer(mockOpenAI.server);
    await closeServer(mockAnthropic.server);
    delete process.env.ROUTER_API_KEY;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ENCRYPTION_KEY;
    delete process.env.LOG_LEVEL;
  });

  const AUTH_HEADER = { authorization: `Bearer ${API_KEY}` };

  it("should complete full OpenAI non-stream flow", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { ...AUTH_HEADER, "content-type": "application/json" },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe("chatcmpl-1");
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message.content).toBe("Hello! How can I help?");

    // 验证日志记录
    const logs = db.prepare("SELECT * FROM request_logs").all() as any[];
    expect(logs.length).toBe(1);
    expect(logs[0].api_type).toBe("openai");
    expect(logs[0].model).toBe("gpt-4");
    expect(logs[0].status_code).toBe(200);
    expect(logs[0].is_stream).toBe(0);
  });

  it("should complete full OpenAI stream flow", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { ...AUTH_HEADER, "content-type": "application/json" },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.body;
    expect(body).toContain("data:");
    expect(body).toContain("[DONE]");

    const logs = db.prepare("SELECT * FROM request_logs").all() as any[];
    expect(logs.length).toBe(1);
    expect(logs[0].is_stream).toBe(1);
  });

  it("should complete full Anthropic non-stream flow", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: {
        ...AUTH_HEADER,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      payload: {
        model: "claude-3-sonnet",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 100,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.type).toBe("message");
    expect(body.content[0].text).toBe("Hello from Claude");

    const logs = db.prepare("SELECT * FROM request_logs").all() as any[];
    expect(logs.length).toBe(1);
    expect(logs[0].api_type).toBe("anthropic");
  });

  it("should apply model mapping in integration", async () => {
    // 配置模型映射：客户端用 gpt-4-mapped，后端收到 gpt-4-turbo
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO model_mappings (id, client_model, backend_model, provider_id, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("map-test", "gpt-4-mapped", "gpt-4-turbo", "svc-openai", 1, now);

    // 创建验证后端收到 model 的 mock
    let receivedModel: string | null = null;
    await closeServer(mockOpenAI.server);
    mockOpenAI = await createMockBackend((req, res) => {
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          const parsed = JSON.parse(body);
          receivedModel = parsed.model;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              id: "chatcmpl-1",
              object: "chat.completion",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: "ok" },
                  finish_reason: "stop",
                },
              ],
              model: parsed.model,
            })
          );
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    // 更新后端服务地址
    db.prepare(
      `UPDATE providers SET base_url = ? WHERE id = ?`
    ).run(`http://127.0.0.1:${mockOpenAI.port}`, "svc-openai");

    await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { ...AUTH_HEADER, "content-type": "application/json" },
      payload: {
        model: "gpt-4-mapped",
        messages: [{ role: "user", content: "test" }],
      },
    });

    expect(receivedModel).toBe("gpt-4-turbo");
  });

  it("should reject request without Authorization with 401", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "test" }],
      },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.type).toBe("invalid_request_error");
  });

  it("should reject request with wrong Authorization with 401", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: "Bearer wrong-key",
        "content-type": "application/json",
      },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "test" }],
      },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.code).toBe("invalid_api_key");
  });

  it("should serve /health without authentication", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});

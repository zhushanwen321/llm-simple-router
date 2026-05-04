import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import {
  createServer,
  Server,
  IncomingMessage,
  ServerResponse,
} from "http";
import Database from "better-sqlite3";
import { createHash } from "crypto";
import { buildApp } from "../src/index.js";
import { encrypt } from "../src/utils/crypto.js";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { hashPassword } from "../src/utils/password.js";
import { DEFAULT_LOOP_PREVENTION_CONFIG } from "llm-router-core/loop-prevention";

const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const API_KEY = "sk-integration-test";

function makeTestConfig() {
  return {
    PORT: 9981,
    DB_PATH: ":memory:",
    LOG_LEVEL: "silent",
    TZ: "Asia/Shanghai",
    STREAM_TIMEOUT_MS: 5000,
    RETRY_BASE_DELAY_MS: 0,
    LOOP_PREVENTION: { ...DEFAULT_LOOP_PREVENTION_CONFIG, enabled: false },
  };
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
    db = initDatabase(":memory:");

    // seed auth/settings so buildApp can read them from DB
    setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
    setSetting(db, "jwt_secret", "test-jwt-secret-for-testing");
    setSetting(db, "admin_password_hash", hashPassword("admin123"));
    setSetting(db, "initialized", "true");

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

    // 插入测试用的 router key，使 auth middleware 能通过 Bearer token 认证
    const apiKeyHash = createHash("sha256").update(API_KEY).digest("hex");
    db.prepare(
      "INSERT INTO router_keys (id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?)"
    ).run("test-key-id", "Test Key", apiKeyHash, API_KEY.slice(0, 8));

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
      `INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      "mg-gpt4",
      "gpt-4",
      JSON.stringify({ targets: [{ backend_model: "gpt-4", provider_id: "svc-openai" }] }),
      1,
      now
    );

    db.prepare(
      `INSERT INTO model_mappings (id, client_model, backend_model, provider_id, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("map-claude3", "claude-3-sonnet", "claude-3-sonnet", "svc-anthropic", 1, now);
    db.prepare(
      `INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      "mg-claude3",
      "claude-3-sonnet",
      JSON.stringify({ targets: [{ backend_model: "claude-3-sonnet", provider_id: "svc-anthropic" }] }),
      1,
      now
    );
  });

  afterEach(async () => {
    await close();
    await closeServer(mockOpenAI.server);
    await closeServer(mockAnthropic.server);
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
    db.prepare(
      `INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      "mg-test",
      "gpt-4-mapped",
      JSON.stringify({ targets: [{ backend_model: "gpt-4-turbo", provider_id: "svc-openai" }] }),
      1,
      now
    );

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

  describe("pipeline_snapshot 端到端", () => {
    it("should record pipeline_snapshot with correct stages for non-stream request", async () => {
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

      const row = db.prepare("SELECT pipeline_snapshot FROM request_logs").get() as any;
      expect(row.pipeline_snapshot).not.toBeNull();

      const stages = JSON.parse(row.pipeline_snapshot);

      // enhancement — 始终存在
      const enh = stages.find((s: any) => s.stage === "enhancement");
      expect(enh).toBeDefined();
      expect(enh.router_tags_stripped).toBe(0);
      expect(enh.directive).toBeNull();

      // routing — 始终存在
      const routing = stages.find((s: any) => s.stage === "routing");
      expect(routing).toBeDefined();
      expect(routing.client_model).toBe("gpt-4");
      expect(routing.backend_model).toBe("gpt-4");
      expect(routing.provider_id).toBe("svc-openai");

      // overflow — 始终存在（triggered: false）
      const overflow = stages.find((s: any) => s.stage === "overflow");
      expect(overflow).toBeDefined();
      expect(overflow.triggered).toBe(false);

      // provider_patch — 始终存在
      const patch = stages.find((s: any) => s.stage === "provider_patch");
      expect(patch).toBeDefined();
      expect(patch.types).toEqual([]);

      // response_transform — 普通场景下 originalModel 为 null，不会注入
      const respTransform = stages.find((s: any) => s.stage === "response_transform");
      expect(respTransform).toBeUndefined();
    });

    it("should preserve raw client_request before any processing", async () => {
      const routerTag = '<router-response type="model-info">test</router-response>';
      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { ...AUTH_HEADER, "content-type": "application/json" },
        payload: {
          model: "gpt-4",
          messages: [{ role: "user", content: `Previous ${routerTag} and current message` }],
        },
      });

      expect(response.statusCode).toBe(200);

      const row = db.prepare("SELECT client_request FROM request_logs").get() as any;
      expect(row.client_request).not.toBeNull();

      const parsed = JSON.parse(row.client_request);
      // client_request 记录的是原始请求深拷贝，应保留 router-response 标签
      expect(parsed.body.messages[0].content).toContain(routerTag);
    });

    it("should record upstream_response before model-info injection", async () => {
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

      const row = db.prepare("SELECT upstream_response FROM request_logs").get() as any;
      expect(row.upstream_response).not.toBeNull();

      const parsed = JSON.parse(row.upstream_response);
      // upstream_response 不含 model-info 标签（普通场景下不会注入）
      const bodyStr = typeof parsed.body === "string" ? parsed.body : JSON.stringify(parsed.body);
      expect(bodyStr).not.toContain('router-response type="model-info"');
    });

    it("should record pipeline_snapshot for stream request", async () => {
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

      const row = db.prepare("SELECT pipeline_snapshot FROM request_logs").get() as any;
      expect(row.pipeline_snapshot).not.toBeNull();

      const stages = JSON.parse(row.pipeline_snapshot);
      const stageNames = stages.map((s: any) => s.stage);

      expect(stageNames).toContain("enhancement");
      expect(stageNames).toContain("routing");
      expect(stageNames).toContain("overflow");
      expect(stageNames).toContain("provider_patch");
    });
  });
});

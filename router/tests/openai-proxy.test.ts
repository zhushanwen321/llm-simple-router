import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { Server } from "http";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { encrypt } from "../src/utils/crypto.js";
import { openaiProxy } from "../src/proxy/handler/openai.js";
import { SemaphoreManager as ProviderSemaphoreManager } from "@llm-router/core/concurrency";
import { RequestTracker } from "@llm-router/core/monitor";
import { createMockBackend } from "./helpers/mock-backend.js";
import { TEST_ENCRYPTION_KEY } from "./helpers/test-setup.js";
import { ServiceContainer, SERVICE_KEYS } from "../src/core/container.js";


function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function buildTestApp(mockDb: Database.Database): FastifyInstance {
  const app = Fastify();
  const semaphoreManager = new ProviderSemaphoreManager();
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

  app.register(openaiProxy, { db: mockDb, container });

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
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
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

// ---------- 测试 ----------

describe("OpenAI proxy", () => {
  let app: FastifyInstance;
  let mockDb: Database.Database;

  beforeEach(() => {
    mockDb = initDatabase(":memory:");
    setSetting(mockDb, "encryption_key", TEST_ENCRYPTION_KEY);
  });

  afterEach(async () => {
    if (app) await app.close();
    if (mockDb) mockDb.close();
  });

  // 1. 非流式请求透传
  it("should proxy non-stream request and return response", async () => {
    const { port, close } = await createMockBackend(
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

    await close();
  });

  // 2. SSE 流式透传
  it("should proxy SSE stream request and forward chunks", async () => {
    const { port, close } = await createMockBackend(
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
    insertModelMapping(mockDb, "gpt-4", "gpt-4");

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

    await close();
  });

  // 3. 模型映射替换
  it("should replace model name when mapping exists", async () => {
    let receivedBody: string = "";

    const { port, close } = await createMockBackend(
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

    await close();
  });

  // 4. 模型无映射 - 返回 404
  it("should return 404 when no model mapping exists", async () => {
    const { server: backendServer, port } = await createMockBackend(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(OPENAI_NON_STREAM_RESPONSE));
      }
    );

    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);

    // 不插入映射
    app = buildTestApp(mockDb);
    const response = await sendRequest(app, {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.statusCode).toBe(404);
    const json = response.json();
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe("model_not_found");

    await closeServer(backendServer);
  });

  // 5. 后端不可达 - 返回 502
  it("should return 502 when backend is unreachable", async () => {
    // 指向一个不存在的端口
    insertMockBackend(mockDb, "http://127.0.0.1:19999");
    insertModelMapping(mockDb, "gpt-4", "gpt-4");

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
      (_req, res) => {
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
    insertModelMapping(mockDb, "gpt-4", "gpt-4");

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

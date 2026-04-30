import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { encrypt } from "../src/utils/crypto.js";
import { openaiProxy } from "../src/proxy/handler/openai.js";
import { ProviderSemaphoreManager } from "../src/proxy/orchestration/semaphore.js";
import { RequestTracker } from "../src/monitor/request-tracker.js";
import { createMockBackend } from "./helpers/mock-backend.js";
import { TEST_ENCRYPTION_KEY } from "./helpers/test-setup.js";
import { ServiceContainer, SERVICE_KEYS } from "../src/core/container.js";


function insertProvider(
  db: Database.Database,
  id: string,
  baseUrl: string,
  apiType = "openai",
  models: string = "[]",
  contextWindows: Record<string, number> = {},
) {
  const now = new Date().toISOString();
  const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);
  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, models, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, `Provider-${id}`, apiType, baseUrl, encryptedKey, 1, models, now, now);

  const stmt = db.prepare(
    "INSERT INTO provider_model_info (provider_id, model_name, context_window) VALUES (?, ?, ?)",
  );
  for (const [modelName, ctx] of Object.entries(contextWindows)) {
    stmt.run(id, modelName, ctx);
  }
}

function insertMappingGroup(
  db: Database.Database,
  id: string,
  clientModel: string,
  target: Record<string, string>,
) {
  const now = new Date().toISOString();
  const rule = JSON.stringify({ targets: [target] });
  db.prepare(
    `INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, clientModel, rule, 1, now);
}

function buildTestApp(db: Database.Database): FastifyInstance {
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
  app.register(openaiProxy, { db: db, container });
  return app;
}

function closeServer(server: { close: () => Promise<void> }): Promise<void> {
  return server.close();
}

describe("overflow redirect integration", () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
  });

  afterEach(async () => {
    if (app) await app.close();
    if (db) db.close();
  });

  it("should proxy normally when context is well under limit", async () => {
    const { port, close } = await createMockBackend((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-default",
        object: "chat.completion",
        model: "small-model",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
      }));
    });

    insertProvider(db, "p-default", `http://127.0.0.1:${port}`, "openai",
      JSON.stringify(["small-model"]), { "small-model": 200000 });
    insertProvider(db, "p-overflow", `http://127.0.0.1:1`, "openai",
      JSON.stringify(["big-model"]), { "big-model": 1000000 });
    insertMappingGroup(db, "mg1", "small-model", {
      backend_model: "small-model",
      provider_id: "p-default",
      overflow_provider_id: "p-overflow",
      overflow_model: "big-model",
    });

    app = buildTestApp(db);
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "small-model",
        messages: [{ role: "user", content: "Hello" }],
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.choices[0].message.content).toBe("ok");
    await closeServer({ close });
  });

  it("should redirect to overflow model when context exceeds window", async () => {
    let overflowReceivedModel = "";
    const { port: overflowPort, close: closeOverflow } = await createMockBackend((req, res) => {
      let body = "";
      req.on("data", (chunk: string) => { body += chunk; });
      req.on("end", () => {
        overflowReceivedModel = JSON.parse(body).model;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: "chatcmpl-overflow",
          object: "chat.completion",
          model: "big-model",
          choices: [{ index: 0, message: { role: "assistant", content: "overflow response" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
        }));
      });
    });

    // 默认 provider 不应被调用
    const { port: defaultPort, close: closeDefault } = await createMockBackend((_req, res) => {
      res.writeHead(500);
      res.end("should not reach default provider");
    });

    // 小 context window (200 tokens) — 长消息会溢出
    insertProvider(db, "p-default", `http://127.0.0.1:${defaultPort}`, "openai",
      JSON.stringify(["small-model"]), { "small-model": 200 });
    insertProvider(db, "p-overflow", `http://127.0.0.1:${overflowPort}`, "openai",
      JSON.stringify(["big-model"]), { "big-model": 1000000 });
    insertMappingGroup(db, "mg1", "small-model", {
      backend_model: "small-model",
      provider_id: "p-default",
      overflow_provider_id: "p-overflow",
      overflow_model: "big-model",
    });

    app = buildTestApp(db);
    // 构造超过 200 tokens 上下文的消息（字符数 / 3 近似 token 数）
    const bigContent = "A ".repeat(400);
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "small-model",
        messages: [{ role: "user", content: bigContent }],
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.id).toBe("chatcmpl-overflow");
    expect(json.choices[0].message.content).toBe("overflow response");
    // 上游收到的 model 应该是溢出模型
    expect(overflowReceivedModel).toBe("big-model");

    await closeDefault();
    await closeOverflow();
  });

  it("should pass through without overflow when no overflow configured", async () => {
    const { port, close } = await createMockBackend((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-default",
        object: "chat.completion",
        model: "small-model",
        choices: [{ index: 0, message: { role: "assistant", content: "direct response" }, finish_reason: "stop" }],
      }));
    });

    // 小 context window，但未配置 overflow 字段
    insertProvider(db, "p-default", `http://127.0.0.1:${port}`, "openai",
      JSON.stringify(["small-model"]), { "small-model": 200 });
    insertMappingGroup(db, "mg1", "small-model", {
      backend_model: "small-model",
      provider_id: "p-default",
    });

    app = buildTestApp(db);
    const bigContent = "A ".repeat(400);
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "small-model",
        messages: [{ role: "user", content: bigContent }],
      },
    });

    // 没有 overflow 配置，直接透传到默认模型（上游可能返回错误，但代理层不做拦截）
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.choices[0].message.content).toBe("direct response");
    await closeServer({ close });
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { Server } from "http";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { encrypt } from "../src/utils/crypto.js";
import { openaiProxy } from "../src/proxy/openai.js";
import { ProviderSemaphoreManager } from "../src/proxy/semaphore.js";
import { RequestTracker } from "../src/monitor/request-tracker.js";
import { createMockBackend } from "./helpers/mock-backend.js";
import { TEST_ENCRYPTION_KEY } from "./helpers/test-setup.js";

// --- helper: 供 proxy-enhancement 设置中注入 compact 配置 ---
function setCompactConfig(
  db: Database.Database,
  config: Record<string, unknown>,
) {
  const existing = JSON.parse(
    (db.prepare("SELECT value FROM settings WHERE key = 'proxy_enhancement'").get() as { value: string } | undefined)?.value ?? "{}",
  );
  setSetting(db, "proxy_enhancement", JSON.stringify({ ...existing, ...config }));
}

function insertProvider(
  db: Database.Database,
  id: string,
  baseUrl: string,
  apiType = "openai",
  models: string = "[]",
) {
  const now = new Date().toISOString();
  const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);
  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, models, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, `Provider-${id}`, apiType, baseUrl, encryptedKey, 1, models, now, now);
}

function insertMapping(
  db: Database.Database,
  clientModel: string,
  backendModel: string,
  providerId: string,
) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO model_mappings (id, client_model, backend_model, provider_id, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("map-1", clientModel, backendModel, providerId, 1, now);
  db.prepare(
    `INSERT INTO mapping_groups (id, client_model, strategy, rule, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    "mg-1",
    clientModel,
    "scheduled",
    JSON.stringify({ default: { backend_model: backendModel, provider_id: providerId } }),
    now,
  );
}

function buildTestApp(db: Database.Database): FastifyInstance {
  const app = Fastify();
  const semaphoreManager = new ProviderSemaphoreManager();
  const tracker = new RequestTracker({ semaphoreManager });
  app.register(openaiProxy, {
    db,
    streamTimeoutMs: 5000,
    retryBaseDelayMs: 0,
    semaphoreManager,
    tracker,
  });
  return app;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

// ---------- 集成测试：compact 请求重定向 ----------

describe("context compact integration", () => {
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

  it("should proxy normal request when tokens are under limit", async () => {
    const { port, close } = await createMockBackend((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        model: "small-model",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
      }));
    });

    // 10k context window — 远大于小消息
    insertProvider(db, "svc-main", `http://127.0.0.1:${port}`, "openai",
      JSON.stringify([{ name: "small-model", context_window: 10000 }]));
    insertMapping(db, "small-model", "small-model", "svc-main");

    setCompactConfig(db, {
      context_compact_enabled: true,
      compact_provider_id: null,
      compact_model: null,
      custom_prompt_enabled: false,
      custom_prompt: null,
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
    await close();
  });

  it("should return 400 when tokens exceed context window", async () => {
    const { port, close } = await createMockBackend((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "test" }));
    });

    // 非常小的 context window（100 tokens）
    insertProvider(db, "svc-main", `http://127.0.0.1:${port}`, "openai",
      JSON.stringify([{ name: "tiny-model", context_window: 100 }]));
    insertMapping(db, "tiny-model", "tiny-model", "svc-main");

    setCompactConfig(db, {
      context_compact_enabled: true,
      compact_provider_id: null,
      compact_model: null,
      custom_prompt_enabled: false,
      custom_prompt: null,
    });

    app = buildTestApp(db);

    // 构造一个足够大的 payload 使得 JSON.stringify(body).length / 3 > 100
    const bigContent = "A".repeat(500);
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "tiny-model",
        messages: [{ role: "user", content: bigContent }],
      },
    });

    expect(res.statusCode).toBe(400);
    const json = res.json();
    expect(JSON.stringify(json).toLowerCase()).toContain("prompt is too long");
    await close();
  });

  it("should not check overflow for 1M+ context models", async () => {
    const { port, close } = await createMockBackend((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        model: "big-model",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
      }));
    });

    // 1M context window
    insertProvider(db, "svc-big", `http://127.0.0.1:${port}`, "openai",
      JSON.stringify([{ name: "big-model", context_window: 2000000 }]));
    insertMapping(db, "big-model", "big-model", "svc-big");

    setCompactConfig(db, {
      context_compact_enabled: true,
      compact_provider_id: null,
      compact_model: null,
      custom_prompt_enabled: false,
      custom_prompt: null,
    });

    app = buildTestApp(db);
    const bigContent = "A".repeat(500);
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "big-model",
        messages: [{ role: "user", content: bigContent }],
      },
    });

    // 即使 payload 相对较大，1M+ 模型不做溢出检查
    expect(res.statusCode).toBe(200);
    await close();
  });

  it("should redirect compact request to configured compact model", async () => {
    // compact 目标的后端
    const { port: compactPort, close: closeCompact } = await createMockBackend((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-compact",
        object: "chat.completion",
        model: "1m-model",
        choices: [{ index: 0, message: { role: "assistant", content: "summary result" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      }));
    });

    // 原始目标的后端（不应被调用）
    const { port: mainPort, close: closeMain } = await createMockBackend((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-main",
        object: "chat.completion",
        model: "small-model",
        choices: [{ index: 0, message: { role: "assistant", content: "should not reach here" }, finish_reason: "stop" }],
      }));
    });

    insertProvider(db, "svc-main", `http://127.0.0.1:${mainPort}`, "openai",
      JSON.stringify([{ name: "small-model", context_window: 10000 }]));
    insertProvider(db, "svc-compact", `http://127.0.0.1:${compactPort}`, "openai",
      JSON.stringify([{ name: "1m-model", context_window: 1000000 }]));
    insertMapping(db, "small-model", "small-model", "svc-main");

    setCompactConfig(db, {
      context_compact_enabled: true,
      compact_provider_id: "svc-compact",
      compact_model: "1m-model",
      custom_prompt_enabled: false,
      custom_prompt: null,
    });

    app = buildTestApp(db);
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "small-model",
        messages: [
          { role: "user", content: "normal message" },
          { role: "assistant", content: "response" },
          { role: "user", content: "CRITICAL: Respond with TEXT ONLY. Do NOT call any tools. Summarize the conversation." },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    // 应该由 compact 后端响应
    expect(json.id).toBe("chatcmpl-compact");
    expect(json.choices[0].message.content).toBe("summary result");

    await closeMain();
    await closeCompact();
  });

  it("should replace prompt when custom_prompt_enabled", async () => {
    let receivedBody = "";
    const { port: compactPort, close: closeCompact } = await createMockBackend((req, res) => {
      let body = "";
      req.on("data", (chunk: string) => { body += chunk; });
      req.on("end", () => {
        receivedBody = body;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: "chatcmpl-compact",
          object: "chat.completion",
          model: "1m-model",
          choices: [{ index: 0, message: { role: "assistant", content: "custom summary" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 },
        }));
      });
    });

    const { port: mainPort, close: closeMain } = await createMockBackend((_req, res) => {
      res.writeHead(500);
      res.end("should not reach main");
    });

    insertProvider(db, "svc-main", `http://127.0.0.1:${mainPort}`, "openai",
      JSON.stringify([{ name: "small-model", context_window: 10000 }]));
    insertProvider(db, "svc-compact", `http://127.0.0.1:${compactPort}`, "openai",
      JSON.stringify([{ name: "1m-model", context_window: 1000000 }]));
    insertMapping(db, "small-model", "small-model", "svc-main");

    setCompactConfig(db, {
      context_compact_enabled: true,
      compact_provider_id: "svc-compact",
      compact_model: "1m-model",
      custom_prompt_enabled: true,
      custom_prompt: "Please provide a concise summary.",
    });

    app = buildTestApp(db);
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "small-model",
        messages: [
          { role: "user", content: "normal message" },
          { role: "user", content: "Your task is to create a detailed summary of the conversation so far. Please do this." },
        ],
      },
    });

    expect(res.statusCode).toBe(200);

    // 验证最后一条 user message 被替换
    const parsed = JSON.parse(receivedBody);
    const lastMsg = parsed.messages[parsed.messages.length - 1];
    expect(lastMsg.content).toBe("Please provide a concise summary.");

    await closeMain();
    await closeCompact();
  });

  it("should pass through when context_compact_enabled is false", async () => {
    const { port, close } = await createMockBackend((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        model: "tiny-model",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      }));
    });

    insertProvider(db, "svc-main", `http://127.0.0.1:${port}`, "openai",
      JSON.stringify([{ name: "tiny-model", context_window: 100 }]));
    insertMapping(db, "tiny-model", "tiny-model", "svc-main");

    // compact 功能关闭
    setCompactConfig(db, {
      context_compact_enabled: false,
      compact_provider_id: null,
      compact_model: null,
      custom_prompt_enabled: false,
      custom_prompt: null,
    });

    app = buildTestApp(db);
    const bigContent = "A".repeat(500);
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "tiny-model",
        messages: [{ role: "user", content: bigContent }],
      },
    });

    // compact 关闭时不做溢出检查，正常透传
    expect(res.statusCode).toBe(200);
    await close();
  });

  it("should not redirect compact request when compact provider not configured", async () => {
    const { port, close } = await createMockBackend((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-main",
        object: "chat.completion",
        model: "small-model",
        choices: [{ index: 0, message: { role: "assistant", content: "main response" }, finish_reason: "stop" }],
      }));
    });

    insertProvider(db, "svc-main", `http://127.0.0.1:${port}`, "openai",
      JSON.stringify([{ name: "small-model", context_window: 1000000 }]));
    insertMapping(db, "small-model", "small-model", "svc-main");

    // compact 功能开启但没有配置 compact_provider_id
    setCompactConfig(db, {
      context_compact_enabled: true,
      compact_provider_id: null,
      compact_model: null,
      custom_prompt_enabled: false,
      custom_prompt: null,
    });

    app = buildTestApp(db);
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "small-model",
        messages: [
          { role: "user", content: "CRITICAL: Respond with TEXT ONLY. Summarize." },
        ],
      },
    });

    // 没有 compact provider 配置，走原始 provider
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.id).toBe("chatcmpl-main");
    await close();
  });
});

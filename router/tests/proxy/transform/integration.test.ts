import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { Server } from "http";
import Database from "better-sqlite3";
import { createHash } from "crypto";
import { initDatabase } from "../../../src/db/index.js";
import { setSetting } from "../../../src/db/settings.js";
import { encrypt } from "../../../src/utils/crypto.js";
import { openaiProxy } from "../../../src/proxy/handler/openai.js";
import { anthropicProxy } from "../../../src/proxy/handler/anthropic.js";
import { SemaphoreManager as ProviderSemaphoreManager } from "@llm-router/core/concurrency";
import { RequestTracker } from "@llm-router/core/monitor";
import { ServiceContainer, SERVICE_KEYS } from "../../../src/core/container.js";
import { ProxyAgentFactory } from "../../../src/proxy/transport/proxy-agent.js";
import { createMockBackend } from "../../helpers/mock-backend.js";
import { TEST_ENCRYPTION_KEY } from "../../helpers/test-setup.js";

// ─── Helpers ───

function buildOAApp(db: Database.Database): FastifyInstance {
  const app = Fastify();
  const semaphoreManager = new ProviderSemaphoreManager();
  const tracker = new RequestTracker({ semaphoreManager });
  const container = new ServiceContainer();
  container.register(SERVICE_KEYS.semaphoreManager, () => semaphoreManager);
  container.register(SERVICE_KEYS.tracker, () => tracker);
  container.register(SERVICE_KEYS.matcher, () => undefined);
  container.register(SERVICE_KEYS.usageWindowTracker, () => undefined);
  container.register(SERVICE_KEYS.sessionTracker, () => undefined);
  container.register(SERVICE_KEYS.adaptiveController, () => undefined);
  container.register(SERVICE_KEYS.logFileWriter, () => null);
  container.register(SERVICE_KEYS.pluginRegistry, () => undefined);
  container.register(SERVICE_KEYS.proxyAgentFactory, () => new ProxyAgentFactory());
  app.register(openaiProxy, { db, container });
  return app;
}

function buildAntApp(db: Database.Database): FastifyInstance {
  const app = Fastify();
  const semaphoreManager = new ProviderSemaphoreManager();
  const tracker = new RequestTracker({ semaphoreManager });
  const container = new ServiceContainer();
  container.register(SERVICE_KEYS.semaphoreManager, () => semaphoreManager);
  container.register(SERVICE_KEYS.tracker, () => tracker);
  container.register(SERVICE_KEYS.matcher, () => undefined);
  container.register(SERVICE_KEYS.usageWindowTracker, () => undefined);
  container.register(SERVICE_KEYS.sessionTracker, () => undefined);
  container.register(SERVICE_KEYS.adaptiveController, () => undefined);
  container.register(SERVICE_KEYS.logFileWriter, () => null);
  container.register(SERVICE_KEYS.pluginRegistry, () => undefined);
  container.register(SERVICE_KEYS.proxyAgentFactory, () => new ProxyAgentFactory());
  app.register(anthropicProxy, { db, container });
  return app;
}

function insertProvider(db: Database.Database, id: string, apiType: string, baseUrl: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, `Mock ${apiType}`, apiType, baseUrl, encrypt("sk-key", TEST_ENCRYPTION_KEY), 1, now, now);
}

function insertMapping(db: Database.Database, clientModel: string, backendModel: string, providerId: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO model_mappings (id, client_model, backend_model, provider_id, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(`map-${providerId}`, clientModel, backendModel, providerId, 1, now);
  db.prepare(
    `INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    `mg-${providerId}`, clientModel,
    JSON.stringify({ targets: [{ backend_model: backendModel, provider_id: providerId }] }),
    1, now,
  );
}

function insertRouterKey(db: Database.Database): string {
  const key = "sk-test-router-key";
  const hash = createHash("sha256").update(key).digest("hex");
  db.prepare(
    `INSERT INTO router_keys (id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?)`
  ).run("rk-1", "Test Key", hash, key.slice(0, 8));
  return key;
}

// ─── Anthropic SSE Events ───

function antTextSSE(text: string, model = "claude-3"): string[] {
  return [
    `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg-1", type: "message", role: "assistant", content: [], model, usage: { input_tokens: 5, output_tokens: 0 } } })}\n\n`,
    `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })}\n\n`,
    `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  ];
}

// ─── OpenAI SSE Chunks ───

function oaTextSSE(text: string, model = "gpt-4"): string[] {
  return [
    `data: ${JSON.stringify({ id: "cmpl-1", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ id: "cmpl-1", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ id: "cmpl-1", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
    `data: ${JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 3 } })}\n\n`,
    "data: [DONE]\n\n",
  ];
}

// ═══════════════════════════════════════════════════════════════
// T14: OA→OA 直通
// ═══════════════════════════════════════════════════════════════

describe("Integration: OA→OA passthrough", () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
  });
  afterEach(async () => {
    if (app) await app.close();
    db.close();
  });

  it("non-stream passthrough", async () => {
    const backend = await createMockBackend((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        // Verify OpenAI format received
        expect(parsed.model).toBe("gpt-4");
        expect(parsed.messages[0].content).toBe("hi");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: "cmpl-1", object: "chat.completion", model: "gpt-4",
          choices: [{ index: 0, message: { role: "assistant", content: "Hello!" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }));
      });
    });

    insertProvider(db, "svc-oa", "openai", `http://127.0.0.1:${backend.port}`);
    insertMapping(db, "gpt-4", "gpt-4", "svc-oa");
    app = buildOAApp(db);

    const res = await app.inject({
      method: "POST", url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: { model: "gpt-4", messages: [{ role: "user", content: "hi" }], max_tokens: 100 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.choices[0].message.content).toBe("Hello!");
    expect(body.choices[0].finish_reason).toBe("stop");
    await backend.close();
  });

  it("stream passthrough", async () => {
    const chunks = oaTextSSE("Hi there");
    const backend = await createMockBackend((req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      for (const c of chunks) res.write(c);
      res.end();
    });

    insertProvider(db, "svc-oa", "openai", `http://127.0.0.1:${backend.port}`);
    insertMapping(db, "gpt-4", "gpt-4", "svc-oa");
    app = buildOAApp(db);

    const res = await app.inject({
      method: "POST", url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: { model: "gpt-4", messages: [{ role: "user", content: "hi" }], stream: true, max_tokens: 100 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"content":"Hi there"');
    expect(res.body).toContain("[DONE]");
    await backend.close();
  });
});

// ═══════════════════════════════════════════════════════════════
// T15: Ant→Ant 直通
// ═══════════════════════════════════════════════════════════════

describe("Integration: Ant→Ant passthrough", () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
  });
  afterEach(async () => {
    if (app) await app.close();
    db.close();
  });

  it("non-stream passthrough", async () => {
    const backend = await createMockBackend((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        expect(parsed.model).toBe("claude-3");
        expect(parsed.max_tokens).toBe(100);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: "msg-1", type: "message", role: "assistant", model: "claude-3",
          content: [{ type: "text", text: "Hello!" }],
          stop_reason: "end_turn", stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 2 },
        }));
      });
    });

    insertProvider(db, "svc-ant", "anthropic", `http://127.0.0.1:${backend.port}`);
    insertMapping(db, "claude-3", "claude-3", "svc-ant");
    app = buildAntApp(db);

    const res = await app.inject({
      method: "POST", url: "/v1/messages",
      headers: { "content-type": "application/json" },
      payload: { model: "claude-3", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], max_tokens: 100 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content[0].text).toBe("Hello!");
    expect(body.stop_reason).toBe("end_turn");
    await backend.close();
  });

  it("stream passthrough", async () => {
    const events = antTextSSE("Hello from Claude");
    const backend = await createMockBackend((req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      for (const e of events) res.write(e);
      res.end();
    });

    insertProvider(db, "svc-ant", "anthropic", `http://127.0.0.1:${backend.port}`);
    insertMapping(db, "claude-3", "claude-3", "svc-ant");
    app = buildAntApp(db);

    const res = await app.inject({
      method: "POST", url: "/v1/messages",
      headers: { "content-type": "application/json" },
      payload: { model: "claude-3", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], stream: true, max_tokens: 100 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"text":"Hello from Claude"');
    expect(res.body).toContain("message_stop");
    await backend.close();
  });
});

// ═══════════════════════════════════════════════════════════════
// T16+T17: OA→Ant 转换（OpenAI 入口，Anthropic Provider）
// ═══════════════════════════════════════════════════════════════

describe("Integration: OA→Ant cross-format", () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
  });
  afterEach(async () => {
    if (app) await app.close();
    db.close();
  });

  it("non-stream: converts request OA→Ant and response Ant→OA", async () => {
    const backend = await createMockBackend((req, res) => {
      expect(req.url).toBe("/v1/messages"); // upstream path converted
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        // Request was converted to Anthropic format
        expect(parsed.max_tokens).toBe(100);
        expect(Array.isArray(parsed.messages)).toBe(true);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: "msg-1", type: "message", role: "assistant", model: "claude-3",
          content: [{ type: "text", text: "Hello from Claude!" }],
          stop_reason: "end_turn", stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 3 },
        }));
      });
    });

    insertProvider(db, "svc-ant", "anthropic", `http://127.0.0.1:${backend.port}`);
    insertMapping(db, "claude-3", "claude-3", "svc-ant");
    app = buildOAApp(db);

    const res = await app.inject({
      method: "POST", url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: { model: "claude-3", messages: [{ role: "user", content: "hi" }], max_tokens: 100 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Response converted back to OpenAI format
    expect(body.choices[0].message.content).toBe("Hello from Claude!");
    expect(body.choices[0].finish_reason).toBe("stop"); // end_turn → stop
    expect(body.usage.prompt_tokens).toBe(10); // input_tokens → prompt_tokens
    await backend.close();
  });

  it("stream: converts Anthropic SSE to OpenAI SSE chunks", async () => {
    const events = antTextSSE("Hello from Claude");
    const backend = await createMockBackend((req, res) => {
      expect(req.url).toBe("/v1/messages"); // upstream path converted
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      for (const e of events) res.write(e);
      res.end();
    });

    insertProvider(db, "svc-ant", "anthropic", `http://127.0.0.1:${backend.port}`);
    insertMapping(db, "claude-3", "claude-3", "svc-ant");
    app = buildOAApp(db);

    const res = await app.inject({
      method: "POST", url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: { model: "claude-3", messages: [{ role: "user", content: "hi" }], stream: true, max_tokens: 100 },
    });

    expect(res.statusCode).toBe(200);
    // Should receive OpenAI SSE format
    expect(res.body).toContain('"content":"Hello from Claude"');
    expect(res.body).toContain("[DONE]");
    // Should NOT contain Anthropic event names
    expect(res.body).not.toContain("content_block_delta");
    expect(res.body).not.toContain("message_delta");
    await backend.close();
  });
});

// ═══════════════════════════════════════════════════════════════
// T18+T19: Ant→OA 转换（Anthropic 入口，OpenAI Provider）
// ═══════════════════════════════════════════════════════════════

describe("Integration: Ant→OA cross-format", () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
  });
  afterEach(async () => {
    if (app) await app.close();
    db.close();
  });

  it("non-stream: converts request Ant→OA and response OA→Ant", async () => {
    const backend = await createMockBackend((req, res) => {
      expect(req.url).toBe("/v1/chat/completions"); // upstream path converted
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        // Request was converted to OpenAI format
        expect(typeof parsed.messages[0].content).toBe("string");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: "cmpl-1", object: "chat.completion", model: "gpt-4",
          choices: [{ index: 0, message: { role: "assistant", content: "Hi there!" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }));
      });
    });

    insertProvider(db, "svc-oa", "openai", `http://127.0.0.1:${backend.port}`);
    insertMapping(db, "gpt-4", "gpt-4", "svc-oa");
    app = buildAntApp(db);

    const res = await app.inject({
      method: "POST", url: "/v1/messages",
      headers: { "content-type": "application/json" },
      payload: { model: "gpt-4", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], max_tokens: 100 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Response converted back to Anthropic format
    expect(body.content[0].type).toBe("text");
    expect(body.content[0].text).toBe("Hi there!");
    expect(body.stop_reason).toBe("end_turn"); // stop → end_turn
    await backend.close();
  });

  it("stream: converts OpenAI SSE to Anthropic SSE events", async () => {
    const chunks = oaTextSSE("Hi from GPT");
    const backend = await createMockBackend((req, res) => {
      expect(req.url).toBe("/v1/chat/completions"); // upstream path converted
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      for (const c of chunks) res.write(c);
      res.end();
    });

    insertProvider(db, "svc-oa", "openai", `http://127.0.0.1:${backend.port}`);
    insertMapping(db, "gpt-4", "gpt-4", "svc-oa");
    app = buildAntApp(db);

    const res = await app.inject({
      method: "POST", url: "/v1/messages",
      headers: { "content-type": "application/json" },
      payload: { model: "gpt-4", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], stream: true, max_tokens: 100 },
    });

    expect(res.statusCode).toBe(200);
    // Should receive Anthropic SSE format
    expect(res.body).toContain("message_start");
    expect(res.body).toContain("content_block_delta");
    expect(res.body).toContain('"text":"Hi from GPT"');
    expect(res.body).toContain("message_stop");
    // Should NOT contain OpenAI format markers
    expect(res.body).not.toContain('"finish_reason"');
    await backend.close();
  });
});

// ═══════════════════════════════════════════════════════════════
// T20: 错误场景
// ═══════════════════════════════════════════════════════════════

describe("Integration: cross-format error handling", () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
  });
  afterEach(async () => {
    if (app) await app.close();
    db.close();
  });

  it("OA→Ant: upstream 400 error converted to OpenAI format", async () => {
    const backend = await createMockBackend((req, res) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Bad request" } }));
    });

    insertProvider(db, "svc-ant", "anthropic", `http://127.0.0.1:${backend.port}`);
    insertMapping(db, "claude-3", "claude-3", "svc-ant");
    app = buildOAApp(db);

    const res = await app.inject({
      method: "POST", url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: { model: "claude-3", messages: [{ role: "user", content: "hi" }], max_tokens: 100 },
    });

    // Proxy returns upstream status code or 502
    expect(res.statusCode).toBe(400);
    const body = res.json();
    // Error should be in OpenAI format
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain("Bad request");
    await backend.close();
  });

  it("Ant→OA: upstream 400 error converted to Anthropic format", async () => {
    const backend = await createMockBackend((req, res) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: { message: "Bad request", type: "invalid_request_error", code: "bad_request" },
      }));
    });

    insertProvider(db, "svc-oa", "openai", `http://127.0.0.1:${backend.port}`);
    insertMapping(db, "gpt-4", "gpt-4", "svc-oa");
    app = buildAntApp(db);

    const res = await app.inject({
      method: "POST", url: "/v1/messages",
      headers: { "content-type": "application/json" },
      payload: { model: "gpt-4", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], max_tokens: 100 },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBeDefined();
    await backend.close();
  });

  it("OA→Ant: upstream connection failure", async () => {
    // Provider pointing to unreachable port
    insertProvider(db, "svc-down", "anthropic", "http://127.0.0.1:1");
    insertMapping(db, "down-model", "down-model", "svc-down");
    app = buildOAApp(db);

    const res = await app.inject({
      method: "POST", url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: { model: "down-model", messages: [{ role: "user", content: "hi" }], max_tokens: 100 },
    });

    expect(res.statusCode).toBe(502);
  });

  it("Ant→OA: upstream connection failure", async () => {
    insertProvider(db, "svc-down", "openai", "http://127.0.0.1:1");
    insertMapping(db, "down-model", "down-model", "svc-down");
    app = buildAntApp(db);

    const res = await app.inject({
      method: "POST", url: "/v1/messages",
      headers: { "content-type": "application/json" },
      payload: { model: "down-model", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], max_tokens: 100 },
    });

    expect(res.statusCode).toBe(502);
  });

  it("OA→Ant stream mid-error converts to OpenAI error chunk", async () => {
    const backend = await createMockBackend((req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      // Start normally with message_start
      res.write(`data: ${JSON.stringify({
        type: "message_start",
        message: { id: "msg-err", model: "claude-3", role: "assistant", content: [], usage: { input_tokens: 5, output_tokens: 0 } },
      })}\n\n`);
      // Send a text block start
      res.write(`data: ${JSON.stringify({
        type: "content_block_start", index: 0, content_block: { type: "text", text: "" },
      })}\n\n`);
      // Send partial text
      res.write(`data: ${JSON.stringify({
        type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" },
      })}\n\n`);
      // Error mid-stream
      res.write(`data: ${JSON.stringify({
        type: "error", error: { type: "overloaded_error", message: "Server overloaded" },
      })}\n\n`);
      res.end();
    });

    insertProvider(db, "svc-ant", "anthropic", `http://127.0.0.1:${backend.port}`);
    insertMapping(db, "claude-3", "claude-3", "svc-ant");
    app = buildOAApp(db);

    const res = await app.inject({
      method: "POST", url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: { model: "claude-3", messages: [{ role: "user", content: "hi" }], stream: true, max_tokens: 100 },
    });

    // Stream started with 200, error delivered inside SSE
    expect(res.statusCode).toBe(200);
    // Should contain the partial text already sent
    expect(res.body).toContain('"content":"Hello"');
    // Should contain error information
    expect(res.body).toContain("error");
    await backend.close();
  });
});

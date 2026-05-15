import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { encrypt } from "../src/utils/crypto.js";
import { createProxyHandler } from "../src/proxy/handler/create-proxy-handler.js";
import { createMockBackend } from "./helpers/mock-backend.js";
import { TEST_ENCRYPTION_KEY } from "./helpers/test-setup.js";
import { createTestContainer } from "./helpers/mapping-reason-test-helper.js";

function insertProvider(
  db: Database.Database,
  id: string,
  baseUrl: string,
  apiType: string,
  models: string,
  contextWindows: Record<string, number>,
) {
  const now = new Date().toISOString();
  const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);
  db.prepare(
  `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, models, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
  id,
  `Provider-${id}`,
  apiType,
  baseUrl,
  encryptedKey,
  1,
  models,
  now,
  now,
  );

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

describe("mappingReason: overflow_redirect", () => {
  let app: FastifyInstance;
  let db: Database.Database;
  const servers: { close: () => Promise<void> }[] = [];

  beforeEach(() => {
  db = initDatabase(":memory:");
  setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
  });

  afterEach(async () => {
  if (app) await app.close();
  for (const s of servers) await s.close();
  servers.length = 0;
  if (db) db.close();
  });

  it("should set mappingReason to overflow_redirect when context exceeds window", async () => {
  // Overflow provider — 接收溢出请求
  const {
    port: overflowPort,
    close: closeOverflow,
  } = await createMockBackend((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
    JSON.stringify({
      id: "chatcmpl-overflow",
      object: "chat.completion",
      model: "big-model",
      choices: [
      {
        index: 0,
        message: { role: "assistant", content: "overflow response" },
        finish_reason: "stop",
      },
      ],
      usage: {
      prompt_tokens: 100,
      completion_tokens: 10,
      total_tokens: 110,
      },
    }),
    );
  });
  servers.push({ close: closeOverflow });

  // Default provider — 不应被调用
  const {
    port: defaultPort,
    close: closeDefault,
  } = await createMockBackend((_req, res) => {
    res.writeHead(500);
    res.end("should not reach default provider");
  });
  servers.push({ close: closeDefault });

  // 小 context window (200 tokens)，长消息会触发溢出
  insertProvider(
    db,
    "p-default",
    `http://127.0.0.1:${defaultPort}`,
    "openai",
    JSON.stringify(["small-model"]),
    { "small-model": 200 },
  );
  insertProvider(
    db,
    "p-overflow",
    `http://127.0.0.1:${overflowPort}`,
    "openai",
    JSON.stringify(["big-model"]),
    { "big-model": 1000000 },
  );
  insertMappingGroup(db, "mg1", "small-model", {
    backend_model: "small-model",
    provider_id: "p-default",
    overflow_provider_id: "p-overflow",
    overflow_model: "big-model",
  });

  const container = createTestContainer();
  app = Fastify();
  app.register(
    createProxyHandler({
    apiType: "openai",
    paths: ["/v1/chat/completions", "/chat/completions"],
    }),
    { db, container },
  );

  // 构造超过 200 tokens 上下文的消息
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

  // 断言 1: DB 中 pipeline_snapshot 的 routing stage 包含 mapping_reason = "overflow_redirect"
  const logRow = db
    .prepare(
    "SELECT pipeline_snapshot FROM request_logs WHERE status_code = 200 ORDER BY rowid DESC LIMIT 1",
    )
    .get() as { pipeline_snapshot: string } | undefined;
  expect(logRow).toBeDefined();

  const stages = JSON.parse(logRow!.pipeline_snapshot) as Array<
    Record<string, unknown>
  >;
  const routingStage = stages.find((s) => s.stage === "routing");
  expect(routingStage).toBeDefined();
  expect(routingStage!.mapping_reason).toBe("overflow_redirect");

  // 断言 2: pipeline_snapshot 的 overflow stage triggered = true
  const overflowStage = stages.find((s) => s.stage === "overflow");
  expect(overflowStage).toBeDefined();
  expect(overflowStage!.triggered).toBe(true);

  // 断言 3: ActiveRequest（通过 tracker.getRecent）包含 mappingReason = "overflow_redirect"
  const tracker = container.resolve<import("../src/core/monitor/index.js").RequestTracker>("tracker");
  const recent = tracker.getRecent();
  const completedReq = recent.find((r) => r.model === "small-model");
  expect(completedReq).toBeDefined();
  expect(completedReq!.mappingReason).toBe("overflow_redirect");
  });

  it("should NOT set mappingReason to overflow_redirect when no overflow occurs", async () => {
  const { port, close } = await createMockBackend((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
    JSON.stringify({
      id: "chatcmpl-default",
      object: "chat.completion",
      model: "small-model",
      choices: [
      {
        index: 0,
        message: { role: "assistant", content: "ok" },
        finish_reason: "stop",
      },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
    }),
    );
  });
  servers.push({ close });

  insertProvider(
    db,
    "p-default",
    `http://127.0.0.1:${port}`,
    "openai",
    JSON.stringify(["small-model"]),
    { "small-model": 200000 },
  );
  insertMappingGroup(db, "mg1", "small-model", {
    backend_model: "small-model",
    provider_id: "p-default",
    overflow_provider_id: "p-overflow",
    overflow_model: "big-model",
  });

  const container = createTestContainer();
  app = Fastify();
  app.register(
    createProxyHandler({
    apiType: "openai",
    paths: ["/v1/chat/completions", "/chat/completions"],
    }),
    { db, container },
  );

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

  // pipeline_snapshot 中 overflow stage triggered = false
  const logRow = db
    .prepare(
    "SELECT pipeline_snapshot FROM request_logs WHERE status_code = 200 ORDER BY rowid DESC LIMIT 1",
    )
    .get() as { pipeline_snapshot: string } | undefined;
  expect(logRow).toBeDefined();

  const stages = JSON.parse(logRow!.pipeline_snapshot) as Array<
    Record<string, unknown>
  >;
  const overflowStage = stages.find((s) => s.stage === "overflow");
  expect(overflowStage).toBeDefined();
  expect(overflowStage!.triggered).toBe(false);

  // routing stage 的 mapping_reason 不应是 overflow_redirect
  const routingStage = stages.find((s) => s.stage === "routing");
  expect(routingStage).toBeDefined();
  expect(routingStage!.mapping_reason).not.toBe("overflow_redirect");
  });
});

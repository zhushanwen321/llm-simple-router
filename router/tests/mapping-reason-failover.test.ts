import { describe, it, expect, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { createHash } from "crypto";
import { encrypt } from "../src/utils/crypto.js";
import { createProxyHandler } from "../src/proxy/handler/create-proxy-handler.js";
import { authMiddleware } from "../src/middleware/auth.js";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { createMockBackend } from "./helpers/mock-backend.js";
import { TEST_ENCRYPTION_KEY } from "./helpers/test-setup.js";
import { createTestContainer } from "./helpers/mapping-reason-test-helper.js";

const API_KEY = "sk-test-router";
const API_KEY_HASH = createHash("sha256").update(API_KEY).digest("hex");

const SUCCESS_BODY = {
  id: "chatcmpl-1",
  object: "chat.completion",
  model: "gpt-4",
  choices: [
  {
    index: 0,
    message: { role: "assistant", content: "Hi" },
    finish_reason: "stop",
  },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

function insertFailoverGroup(
  db: Database.Database,
  url1: string,
  url2: string,
) {
  const now = new Date().toISOString();
  const encryptedKey = encrypt("sk-test-key", TEST_ENCRYPTION_KEY);

  db.prepare(
  `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, models, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
  "prov-primary",
  "Primary",
  "openai",
  url1,
  encryptedKey,
  1,
  JSON.stringify(["gpt-4"]),
  now,
  now,
  );

  db.prepare(
  `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, models, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
  "prov-fallback",
  "Fallback",
  "openai",
  url2,
  encryptedKey,
  1,
  JSON.stringify(["gpt-4"]),
  now,
  now,
  );

  db.prepare(
  `INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at)
   VALUES (?, ?, ?, ?, ?)`,
  ).run(
  "mg-failover",
  "gpt-4",
  JSON.stringify({
    targets: [
    { backend_model: "gpt-4", provider_id: "prov-primary" },
    { backend_model: "gpt-4", provider_id: "prov-fallback" },
    ],
  }),
  1,
  now,
  );

  db.prepare(
  "INSERT INTO router_keys (id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?)",
  ).run("test-router-key", "Test Key", API_KEY_HASH, API_KEY.slice(0, 8));
}

describe("mappingReason: failover_retry", () => {
  let app: FastifyInstance;
  let db: Database.Database;
  const servers: { close: () => Promise<void> }[] = [];

  afterEach(async () => {
  if (app) await app.close();
  for (const s of servers) await s.close();
  servers.length = 0;
  if (db) db.close();
  });

  it("should set mappingReason to failover_retry on 2nd+ iteration when primary returns 500", async () => {
  // Primary 返回 500，触发 failover
  const {
    port: primaryPort,
    close: closePrimary,
  } = await createMockBackend((_req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
    JSON.stringify({
      error: {
      message: "Internal Server Error",
      type: "server_error",
      },
    }),
    );
  });
  servers.push({ close: closePrimary });

  // Fallback 返回 200
  const {
    port: fallbackPort,
    close: closeFallback,
  } = await createMockBackend((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(SUCCESS_BODY));
  });
  servers.push({ close: closeFallback });

  db = initDatabase(":memory:");
  setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
  setSetting(db, "initialized", "true");
  insertFailoverGroup(
    db,
    `http://127.0.0.1:${primaryPort}`,
    `http://127.0.0.1:${fallbackPort}`,
  );

  const container = createTestContainer();
  app = Fastify();
  app.register(authMiddleware, { db });
  app.register(
    createProxyHandler({
    apiType: "openai",
    paths: ["/v1/chat/completions", "/chat/completions"],
    }),
    { db, container },
  );

  const resp = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
    "content-type": "application/json",
    authorization: `Bearer ${API_KEY}`,
    },
    payload: {
    model: "gpt-4",
    messages: [{ role: "user", content: "Hi" }],
    },
  });

  // 请求最终成功（failover 到 fallback）
  expect(resp.statusCode).toBe(200);

  // 断言 1: is_failover=1 的日志的 pipeline_snapshot 中 routing stage mapping_reason = "failover_retry"
  const failoverLog = db
    .prepare(
    "SELECT pipeline_snapshot FROM request_logs WHERE is_failover = 1 ORDER BY rowid DESC LIMIT 1",
    )
    .get() as { pipeline_snapshot: string } | undefined;
  expect(failoverLog).toBeDefined();

  const stages = JSON.parse(failoverLog!.pipeline_snapshot) as Array<
    Record<string, unknown>
  >;
  const routingStage = stages.find((s) => s.stage === "routing");
  expect(routingStage).toBeDefined();
  expect(routingStage!.mapping_reason).toBe("failover_retry");

  // 断言 2: ActiveRequest（通过 tracker.getRecent）的 mappingReason = "failover_retry"
  const tracker = container.resolve<import("../src/core/monitor/index.js").RequestTracker>("tracker");
  const recent = tracker.getRecent();
  // 取最后一个完成的请求（即 failover 成功的那个）
  const failoverReq = recent.find(
    (r) => r.providerId === "prov-fallback" && r.status === "completed",
  );
  expect(failoverReq).toBeDefined();
  expect(failoverReq!.mappingReason).toBe("failover_retry");
  });

  it("should NOT set mappingReason to failover_retry on first iteration (no failover)", async () => {
  // Primary 直接返回 200，不触发 failover
  const {
    port: primaryPort,
    close: closePrimary,
  } = await createMockBackend((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(SUCCESS_BODY));
  });
  servers.push({ close: closePrimary });

  // Fallback — 不应被调用
  const {
    port: fallbackPort,
    close: closeFallback,
  } = await createMockBackend((_req, res) => {
    res.writeHead(500);
    res.end("should not reach fallback");
  });
  servers.push({ close: closeFallback });

  db = initDatabase(":memory:");
  setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
  setSetting(db, "initialized", "true");
  insertFailoverGroup(
    db,
    `http://127.0.0.1:${primaryPort}`,
    `http://127.0.0.1:${fallbackPort}`,
  );

  const container = createTestContainer();
  app = Fastify();
  app.register(authMiddleware, { db });
  app.register(
    createProxyHandler({
    apiType: "openai",
    paths: ["/v1/chat/completions", "/chat/completions"],
    }),
    { db, container },
  );

  const resp = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
    "content-type": "application/json",
    authorization: `Bearer ${API_KEY}`,
    },
    payload: {
    model: "gpt-4",
    messages: [{ role: "user", content: "Hi" }],
    },
  });

  expect(resp.statusCode).toBe(200);

  // 首次迭代的日志 routing stage mapping_reason 不应是 failover_retry
  const logRow = db
    .prepare(
    "SELECT pipeline_snapshot FROM request_logs WHERE is_failover = 0 ORDER BY rowid DESC LIMIT 1",
    )
    .get() as { pipeline_snapshot: string } | undefined;
  expect(logRow).toBeDefined();

  const stages = JSON.parse(logRow!.pipeline_snapshot) as Array<
    Record<string, unknown>
  >;
  const routingStage = stages.find((s) => s.stage === "routing");
  expect(routingStage).toBeDefined();
  expect(routingStage!.mapping_reason).not.toBe("failover_retry");
  });
});

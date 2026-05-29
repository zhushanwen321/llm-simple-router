/**
 * Failover-loop 分层路由集成测试 — TDD RED 阶段。
 *
 * 测试 failover-loop.ts 重构后的分层预计算行为：
 * - BEFORE: resolveMapping / overflow / allowed_models 在 while(true) 循环内逐次决策
 * - AFTER:  resolveMapping → IR → OF 三层在循环外预计算，循环简化为纯执行 + exclude
 *
 * 这些测试必须 FAIL，因为当前实现尚未重构。
 * 失败原因预期：
 * - modality-redirect stage 不���在于 pipeline_snapshot（IR 层未实现）
 * - IR 层未将 image-capable fallback target prepend 到 target 列表
 * - image-capable provider 永远不会被 IR 路径调用
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { type FastifyInstance } from "fastify";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "http";
import Database from "better-sqlite3";
import { createHash } from "crypto";
import { buildApp } from "../src/index.js";
import { encrypt } from "../src/utils/crypto.js";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { hashPassword } from "../src/utils/password.js";
import { DEFAULT_LOOP_PREVENTION_CONFIG } from "../src/core/loop-prevention/index.js";

// ---------- Constants ----------

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const API_KEY = "sk-layered-test-key";

// ---------- Helpers ----------

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
  handler: (req: IncomingMessage, res: ServerResponse) => void,
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

function safeClose(server: Server): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
  try { server.close(() => resolve()); } catch { resolve(); }
  });
}

/** OpenAI 格式的成功响应 */
const OPENAI_SUCCESS = {
  id: "chatcmpl-1",
  object: "chat.completion",
  choices: [
  {
    index: 0,
    message: { role: "assistant", content: "Hello!" },
    finish_reason: "stop",
  },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  model: "gpt-4",
};

/** OpenAI 格式的错误响应 */
function openaiError(statusCode: number, message: string) {
  return {
  error: { message, type: "server_error", code: statusCode },
  };
}

// ---------- Test Suite ----------

describe("Failover-loop layered routing (TDD - expecting FAIL)", () => {
  let db: Database.Database;
  let app: FastifyInstance | undefined;
  let closeFn: (() => Promise<void>) | undefined;
  let serversToClean: Server[] = [];

  function trackServer(s: Server) {
  serversToClean.push(s);
  return s;
  }

  beforeEach(() => {
  db = initDatabase(":memory:");
  setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
  setSetting(db, "jwt_secret", "test-jwt-secret-for-layered-test");
  setSetting(db, "admin_password_hash", hashPassword("admin123"));
  setSetting(db, "initialized", "true");

  app = undefined;
  closeFn = undefined;
  serversToClean = [];
  });

  afterEach(async () => {
  if (closeFn) await closeFn();
  for (const s of serversToClean) {
    await safeClose(s);
  }
  if (db && db.open) db.close();
  });

  const AUTH_HEADER = { authorization: `Bearer ${API_KEY}` };

  /** 插入 router key 用于 Bearer token 认证 */
  function insertRouterKey() {
  const apiKeyHash = createHash("sha256").update(API_KEY).digest("hex");
  db.prepare(
    "INSERT INTO router_keys (id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?)",
  ).run("test-key-id", "Test Key", apiKeyHash, API_KEY.slice(0, 8));
  }

  /** 插入 provider */
  function insertProvider(
  id: string, name: string, baseUrl: string, encryptedKey: string,
    models?: string,
  ) {
  const modelsJson = models ?? JSON.stringify([{ name: "default-model", capabilities: ["text"] }]);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, name, "openai", baseUrl, encryptedKey, modelsJson, 1, now, now);
  }

  /**
   * 插入 mapping group，支持 multimodal_fallback 和 overflow 配置。
   */
  function insertMappingGroup(
  clientModel: string,
  targets: Array<{
    backend_model: string;
    provider_id: string;
    overflow_provider_id?: string;
    overflow_model?: string;
  }>,
  multimodalFallback?: { backend_model: string; provider_id: string },
  ) {
  const now = new Date().toISOString();
  const id = `mg-${clientModel}`;

  for (const t of targets) {
  db.prepare(
  `INSERT OR IGNORE INTO model_mappings (id, client_model, backend_model, provider_id, is_active, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(`mm-${t.provider_id}-${t.backend_model}`, clientModel, t.backend_model, t.provider_id, 1, now);
  }

  const rule: Record<string, unknown> = { targets };
  if (multimodalFallback) {
  rule.multimodal_fallback = multimodalFallback;
  }

  db.prepare(
    `INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, clientModel, JSON.stringify(rule), 1, now);
  }

  /**
   * 构造包含图片的 OpenAI 请求体。
   * messages[0].content 为数组格式，包含 image_url 类型的内容块。
   */
  function makeImageRequestBody(model = "gpt-4") {
  return {
    model,
    messages: [
    {
      role: "user",
      content: [
      { type: "text", text: "What is in this image?" },
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,iVBOR..." },
      },
      ],
    },
    ],
  };
  }

  /** 构造纯文本的 OpenAI 请求体 */
  function makeTextRequestBody(model = "gpt-4") {
  return {
    model,
    messages: [
    { role: "user", content: "Hello, world!" },
    ],
  };
  }

  // ========== Test Cases ==========

  describe("AC18: IR + OF layers correctly expand target list", () => {
  it("test_imageRequest_withFallbackAndOverflow_precomputesExpandedTargets", async () => {
    // 设置：
  // - mapping group: targets=[A(text-only, 有 overflow)], multimodal_fallback={B(image-capable)}
    // - 请求包含图片
    // - 预期 target 列表：[IR_F(B), OF_A, A]
    // - B 返回 200，A 返回 500
  // - pipeline_snapshot 应包含 modality-redirect stage

    let textOnlyCalls = 0;
    let imageCapableCalls = 0;

    // Text-only: 返回 500
    const textOnly = await createMockBackend((_req, res) => {
    textOnlyCalls++;
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify(openaiError(500, "text-only provider error")));
    });
    trackServer(textOnly.server);

    // Image-capable: 返回 200
    const imageCapable = await createMockBackend((_req, res) => {
    imageCapableCalls++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(OPENAI_SUCCESS));
    });
    trackServer(imageCapable.server);

    insertRouterKey();
    const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);
    insertProvider("svc-text-only", "TextOnly", `http://127.0.0.1:${textOnly.port}`, encryptedKey, JSON.stringify([{ name: "gpt-4", capabilities: ["text"] }]));
    insertProvider("svc-image-capable", "ImageCapable", `http://127.0.0.1:${imageCapable.port}`, encryptedKey, JSON.stringify([{ name: "gpt-4o", capabilities: ["text", "image"] }]));

    insertMappingGroup(
    "gpt-4",
    [{
      backend_model: "gpt-4",
      provider_id: "svc-text-only",
      overflow_provider_id: "svc-overflow",
      overflow_model: "gpt-4-large",
    }],
    { backend_model: "gpt-4o", provider_id: "svc-image-capable" },
    );

    const config = makeTestConfig();
    const result = await buildApp({ config, db });
    app = result.app;
    closeFn = result.close;

    const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: { ...AUTH_HEADER, "content-type": "application/json" },
    payload: makeImageRequestBody("gpt-4"),
    });

    // IR 层应该将 image-capable provider prepend 到 target 列表
    // 重构后：IR_F(B) 会被先尝试，B 返回 200 → 成功
    expect(response.statusCode).toBe(200);

    // IR provider 应该被调用（因为图片请求 + 首个 target 不支持图片）
    expect(imageCapableCalls).toBeGreaterThanOrEqual(1);

  // 验证 pipeline_snapshot 包含 modality-redirect stage
    const logs = db.prepare("SELECT pipeline_snapshot FROM request_logs WHERE status_code = 200").all() as Array<{ pipeline_snapshot: string }>;
    expect(logs.length).toBeGreaterThanOrEqual(1);

    const stages = JSON.parse(logs[0].pipeline_snapshot || "[]");
  const irStage = stages.find((s: Record<string, unknown>) => s.stage === "modality-redirect");
  expect(irStage).toBeDefined();
  expect(irStage).toMatchObject({
  stage: "modality-redirect",
  triggered: true,
    redirect_to: "gpt-4o",
    redirect_provider: "svc-image-capable",
    });
  });
  });

  describe("AC19: IR_F replaced — only fallback target attempted", () => {
  it("test_irFallbackReplaced_onlyFallbackAttempted", async () => {
    // 新行为：全部不支持 image → 替换为 fallback B → 只尝试 B
    // B 失败后不再尝试 A（A 不支持 image，已被过滤）

    let textOnlyCalls = 0;
    let imageCapableCalls = 0;

    // A: text-only, 返回 200（不应被调用）
    const textOnly = await createMockBackend((_req, res) => {
    textOnlyCalls++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(OPENAI_SUCCESS));
    });
    trackServer(textOnly.server);

    // B: image-capable fallback, 返回 500
    const imageCapable = await createMockBackend((_req, res) => {
    imageCapableCalls++;
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify(openaiError(500, "image provider internal error")));
    });
    trackServer(imageCapable.server);

    insertRouterKey();
    const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);
    insertProvider("svc-text-only", "TextOnly", `http://127.0.0.1:${textOnly.port}`, encryptedKey, JSON.stringify([{ name: "gpt-4", capabilities: ["text"] }]));
    insertProvider("svc-image-capable", "ImageCapable", `http://127.0.0.1:${imageCapable.port}`, encryptedKey, JSON.stringify([{ name: "gpt-4o", capabilities: ["text", "image"] }]));

    insertMappingGroup(
    "gpt-4",
    [{ backend_model: "gpt-4", provider_id: "svc-text-only" }],
    { backend_model: "gpt-4o", provider_id: "svc-image-capable" },
    );

    const config = makeTestConfig();
    const result = await buildApp({ config, db });
    app = result.app;
    closeFn = result.close;

    const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: { ...AUTH_HEADER, "content-type": "application/json" },
    payload: makeImageRequestBody("gpt-4"),
    });

    // B (fallback) 失败后无更多 target → 5xx
    expect(response.statusCode).toBeGreaterThanOrEqual(500);

    // 只有 B (image-capable fallback) 被调用
    expect(imageCapableCalls).toBe(1);
    // A (text-only) 不应被调用（被 modality 过滤排除）
    expect(textOnlyCalls).toBe(0);

    // 总日志数 ≤ 5（无死循环）
    const logs = db.prepare("SELECT * FROM request_logs").all() as Array<Record<string, unknown>>;
    expect(logs.length).toBeLessThanOrEqual(5);
  });
  });

  describe("Fallback: non-image request — IR layer records triggered:false", () => {
  it("test_textOnlyRequest_IRStageRecordedTriggeredFalse", async () => {
    // 设置：
  // - mapping group: targets=[A(text-only)], multimodal_fallback={B(image-capable)}
  // - 纯文本请求（无图片）
  // - 预期：IR 层执行但不扩展，记录 modality-redirect stage（triggered: false）
  // - B 不被调用
  // - 关键：重构后 IR 层总是执行，pipeline_snapshot 总包含 modality-redirect stage

    let textOnlyCalls = 0;
    let imageCapableCalls = 0;

    // A: 返回 200
    const textOnly = await createMockBackend((_req, res) => {
    textOnlyCalls++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(OPENAI_SUCCESS));
    });
    trackServer(textOnly.server);

    // B: 不应被调用
    const imageCapable = await createMockBackend((_req, res) => {
    imageCapableCalls++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(OPENAI_SUCCESS));
    });
    trackServer(imageCapable.server);

    insertRouterKey();
    const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);
    insertProvider("svc-text-only", "TextOnly", `http://127.0.0.1:${textOnly.port}`, encryptedKey, JSON.stringify([{ name: "gpt-4", capabilities: ["text"] }]));
    insertProvider("svc-image-capable", "ImageCapable", `http://127.0.0.1:${imageCapable.port}`, encryptedKey, JSON.stringify([{ name: "gpt-4o", capabilities: ["text", "image"] }]));

    insertMappingGroup(
    "gpt-4",
    [{ backend_model: "gpt-4", provider_id: "svc-text-only" }],
    { backend_model: "gpt-4o", provider_id: "svc-image-capable" },
    );

    const config = makeTestConfig();
    const result = await buildApp({ config, db });
    app = result.app;
    closeFn = result.close;

    const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: { ...AUTH_HEADER, "content-type": "application/json" },
    payload: makeTextRequestBody("gpt-4"),
    });

    expect(response.statusCode).toBe(200);

    // IR provider 不应被调用（纯文本请求不触发 IR 扩展）
    expect(imageCapableCalls).toBe(0);
    expect(textOnlyCalls).toBe(1);

  // 关键断言：重构后 pipeline_snapshot 应包含 modality-redirect stage（triggered: false）
  // 当前实现不含此 stage，所以测试 FAIL
  const logRow = db.prepare("SELECT pipeline_snapshot FROM request_logs WHERE status_code = 200").get() as { pipeline_snapshot: string };
  expect(logRow).toBeDefined();
  const stages = JSON.parse(logRow.pipeline_snapshot || "[]");
  const irStage = stages.find((s: Record<string, unknown>) => s.stage === "modality-redirect");
  expect(irStage).toBeDefined();
  expect(irStage).toMatchObject({
  stage: "modality-redirect",
  triggered: false,
    });
  });
  });

  describe("Failover: all targets exhausted returns error", () => {
  it("test_allTargetsExhausted_returnsError", async () => {
    // 设置：
  // - mapping group: targets=[A(返回 500)], multimodal_fallback={B(返回 500)}
    // - 请求包含图片
    // - 预期：IR 层展开为 [B, A]，全部失败后返回错误
    // - 总请求数 ≤ 5（无死循环）

    let textOnlyCalls = 0;
    let imageCapableCalls = 0;

    // A: 返回 500
    const textOnly = await createMockBackend((_req, res) => {
    textOnlyCalls++;
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify(openaiError(500, "A fails")));
    });
    trackServer(textOnly.server);

    // B: 返回 500
    const imageCapable = await createMockBackend((_req, res) => {
    imageCapableCalls++;
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify(openaiError(500, "B fails")));
    });
    trackServer(imageCapable.server);

    insertRouterKey();
    const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);
    insertProvider("svc-text-only", "TextOnly", `http://127.0.0.1:${textOnly.port}`, encryptedKey, JSON.stringify([{ name: "gpt-4", capabilities: ["text"] }]));
    insertProvider("svc-image-capable", "ImageCapable", `http://127.0.0.1:${imageCapable.port}`, encryptedKey, JSON.stringify([{ name: "gpt-4o", capabilities: ["text", "image"] }]));

    insertMappingGroup(
    "gpt-4",
    [{ backend_model: "gpt-4", provider_id: "svc-text-only" }],
    { backend_model: "gpt-4o", provider_id: "svc-image-capable" },
    );

    const config = makeTestConfig();
    const result = await buildApp({ config, db });
    app = result.app;
    closeFn = result.close;

    const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: { ...AUTH_HEADER, "content-type": "application/json" },
    payload: makeImageRequestBody("gpt-4"),
    });

    // 应返回 5xx 错误
    expect(response.statusCode).toBeGreaterThanOrEqual(500);

    // 新行为：全部不支持 image → 替换为 fallback B → 只尝试 B
    // B 失败后无更多 target
    expect(imageCapableCalls).toBeGreaterThanOrEqual(1);
    // A (text-only) 不应被调用（被 modality 过滤排除）
    expect(textOnlyCalls).toBe(0);

    // 总请求数 ≤ 5（无死循环）
    const totalCalls = imageCapableCalls + textOnlyCalls;
    expect(totalCalls).toBeLessThanOrEqual(5);
  });
  });

  describe("Pre-computed IR stage always recorded in snapshot", () => {
  it("test_failoverGroup_IRStageAlwaysPresentInSnapshot", async () => {
    // 设置：
  // - mapping group: targets=[A(返回 500), B(返回 200)], 无 multimodal_fallback
    // - 纯文本请求
    // - 预期：A 失败 → failover → B 成功
  // - 关键断言：每次迭代的 snapshot 都应包含 modality-redirect stage（triggered: false）
  //   重构后 IR 层总是执行，这是分层路由已实现的标志

    let textOnlyCalls = 0;
    let imageCapableCalls = 0;

    // A: 返回 500
    const textOnly = await createMockBackend((_req, res) => {
    textOnlyCalls++;
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify(openaiError(500, "A fails")));
    });
    trackServer(textOnly.server);

    // B: 返回 200
    const imageCapable = await createMockBackend((_req, res) => {
    imageCapableCalls++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(OPENAI_SUCCESS));
    });
    trackServer(imageCapable.server);

    insertRouterKey();
    const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);
    insertProvider("svc-text-only", "TextOnly", `http://127.0.0.1:${textOnly.port}`, encryptedKey, JSON.stringify([{ name: "gpt-4", capabilities: ["text"] }]));
    insertProvider("svc-image-capable", "ImageCapable", `http://127.0.0.1:${imageCapable.port}`, encryptedKey, JSON.stringify([{ name: "gpt-4o", capabilities: ["text", "image"] }]));

  // 两个 targets 的 failover group（无 multimodal_fallback）
    insertMappingGroup("gpt-4", [
    { backend_model: "gpt-4", provider_id: "svc-text-only" },
    { backend_model: "gpt-4o", provider_id: "svc-image-capable" },
    ]);

    const config = makeTestConfig();
    const result = await buildApp({ config, db });
    app = result.app;
    closeFn = result.close;

    const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: { ...AUTH_HEADER, "content-type": "application/json" },
    payload: makeTextRequestBody("gpt-4"),
    });

    // 应该成功（B 返回 200）
    expect(response.statusCode).toBe(200);

    // 验证日志中有两条记录：A 失败 + B 成功
    const logs = db.prepare("SELECT pipeline_snapshot, status_code FROM request_logs ORDER BY created_at").all() as Array<{ pipeline_snapshot: string; status_code: number }>;
    expect(logs.length).toBe(2);

    // 第一次：A 的日志
    expect(logs[0].status_code).toBe(500);
    const firstStages = JSON.parse(logs[0].pipeline_snapshot || "[]");
    const firstRouting = firstStages.find((s: Record<string, unknown>) => s.stage === "routing");
    expect(firstRouting).toMatchObject({
    provider_id: "svc-text-only",
    backend_model: "gpt-4",
    strategy: "failover",
    });

    // 第二次：B 的日志（failover 后）
    expect(logs[1].status_code).toBe(200);
    const secondStages = JSON.parse(logs[1].pipeline_snapshot || "[]");
    const secondRouting = secondStages.find((s: Record<string, unknown>) => s.stage === "routing");
    expect(secondRouting).toMatchObject({
    stage: "routing",
    strategy: "failover",
    provider_id: "svc-image-capable",
    backend_model: "gpt-4o",
    });

  // 关键新断言：第一次迭代的 snapshot 应包含 modality-redirect stage（triggered: false）
  // 这是分层路由已实现的标志 — IR 层总是执行，即使不触发重定向
  const firstIR = firstStages.find((s: Record<string, unknown>) => s.stage === "modality-redirect");
  expect(firstIR).toBeDefined();
  expect(firstIR).toMatchObject({ stage: "modality-redirect", triggered: false });
  });
  });
});

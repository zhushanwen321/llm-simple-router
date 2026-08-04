/**
 * Failover-loop + Circuit Breaker + Session Affinity 集成测试（wave cb-failover-integration）。
 *
 * 覆盖设计文档 §4.4（全链回退）、§4.5（计数点表）、§5.3（路由接入）的核心场景：
 * - TC1-TC7：选路场景（绑定优先 / 熔断跳过 / 门控 / 回退 / 绑定写入）
 * - TC8-TC10：计数细节（例外路径 / throw / 白名单）
 * - TC11-TC12：group 绑定（多 group 独立 / 失效覆盖）
 * - TC13-TC15：留痕 / 回退单次性 / provider 停用失效
 *
 * 模式：buildApp（注册 builtin hooks + circuitBreaker 单例），通过真实请求触发 CB 状态。
 * session_id 经默认 client_session_headers（x-claude-code-session-id）注入。
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
const API_KEY = "sk-cb-test-key";
const API_KEY_HASH = createHash("sha256").update(API_KEY).digest("hex");
const SESSION_HEADER = "x-claude-code-session-id";
const SESSION_ID = "sess-1";

const SUCCESS_BODY = {
  id: "chatcmpl-1", object: "chat.completion", model: "gpt-4",
  choices: [{ index: 0, message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

// ---------- Helpers ----------

function makeTestConfig() {
  return {
    PORT: 9981, DB_PATH: ":memory:", LOG_LEVEL: "silent", TZ: "Asia/Shanghai",
    STREAM_TIMEOUT_MS: 5000, RETRY_BASE_DELAY_MS: 0,
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
      if (addr && typeof addr === "object") resolve({ server, port: addr.port });
      else reject(new Error("Failed to get server address"));
    });
  });
}

function safeClose(server: Server): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    try { server.close(() => resolve()); } catch { resolve(); }
  });
}

/** 可变状态后端：getStatus() 决定每次响应状态码，onCall() 回调记录调用 */
function createControllableBackend(opts: {
  getStatus: () => number;
  onCall?: () => void;
}): Promise<{ server: Server; port: number }> {
  return createMockBackend((_req, res) => {
    opts.onCall?.();
    const status = opts.getStatus();
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(status < 400
      ? JSON.stringify(SUCCESS_BODY)
      : JSON.stringify({ error: { message: `error ${status}`, type: "server_error" } }));
  });
}

/** CB 配置：默认 1 次失败即 OPEN（min_samples=1, failure_rate=1.0）便于测试触发 */
function cbConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true, window_sec: 60, failure_rate: 1.0, min_samples: 1, cooldown_sec: 300,
    ...overrides,
  };
}

function setupProvider(db: Database.Database, id: string, baseUrl: string, isActive = 1): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, id, "openai", baseUrl, encrypt("sk-test", TEST_ENCRYPTION_KEY), isActive, now, now);
}

function setupGroup(db: Database.Database, clientModel: string, targets: Record<string, unknown>[]): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(`mg-${clientModel}`, clientModel, JSON.stringify({ targets }), 1, now);
}

function setupRouterKey(db: Database.Database): void {
  db.prepare(
    `INSERT INTO router_keys (id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?)`,
  ).run("rk-1", "Test", API_KEY_HASH, API_KEY.slice(0, 8));
}

function insertBinding(db: Database.Database, groupId: string, providerId: string, model: string, sessionId = SESSION_ID): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO session_model_states (id, router_key_id, session_id, group_id, current_model, original_model, provider_id, last_active_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(`bind-${groupId}-${sessionId}`, "rk-1", sessionId, groupId, model, model, providerId, now, now);
}

async function sendRequest(app: FastifyInstance, model = "gpt-4", sessionId = SESSION_ID) {
  return app.inject({
    method: "POST", url: "/v1/chat/completions",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}`, [SESSION_HEADER]: sessionId },
    payload: { model, messages: [{ role: "user", content: "hi" }] },
  });
}

function getLogs(db: Database.Database): Array<Record<string, unknown>> {
  return db.prepare("SELECT * FROM request_logs ORDER BY rowid ASC").all() as Array<Record<string, unknown>>;
}

function getBindings(db: Database.Database): Array<Record<string, unknown>> {
  return db.prepare("SELECT * FROM session_model_states").all() as Array<Record<string, unknown>>;
}

// ---------- Test Suite ----------

describe("Failover-loop circuit breaker + session affinity integration", () => {
  let db: Database.Database;
  let app: FastifyInstance | undefined;
  let closeFn: (() => Promise<void>) | undefined;
  const servers: Server[] = [];

  beforeEach(() => {
    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
    setSetting(db, "jwt_secret", "test-jwt");
    setSetting(db, "admin_password_hash", hashPassword("admin123"));
    setSetting(db, "initialized", "true");
    app = undefined;
    closeFn = undefined;
    servers.length = 0;
  });

  afterEach(async () => {
    if (closeFn) await closeFn();
    for (const s of servers) await safeClose(s);
    if (db && db.open) db.close();
  });

  async function buildAppWith(db: Database.Database): Promise<void> {
    const result = await buildApp({ config: makeTestConfig(), db });
    app = result.app;
    closeFn = result.close;
  }

  // ========== TC1-TC7: 选路场景 ==========

  it("TC1: 绑定模型在链上 → 首次迭代即用绑定模型，mapping_reason=session_affinity", async () => {
    const p1 = await createControllableBackend({ getStatus: () => 200 });
    const p2 = await createControllableBackend({ getStatus: () => 200 });
    servers.push(p1.server, p2.server);
    setupProvider(db, "p1", `http://127.0.0.1:${p1.port}`);
    setupProvider(db, "p2", `http://127.0.0.1:${p2.port}`);
    setupGroup(db, "gpt-4", [
      { backend_model: "gpt-4", provider_id: "p1", circuit_breaker: cbConfig() },
      { backend_model: "gpt-4", provider_id: "p2", circuit_breaker: cbConfig() },
    ]);
    setupRouterKey(db);
    // 预置绑定到 t2（非链首），验证绑定优先把它前移
    insertBinding(db, "mg-gpt-4", "p2", "gpt-4");
    await buildAppWith(db);

    const resp = await sendRequest(app!);
    expect(resp.statusCode).toBe(200);

    const logs = getLogs(db);
    const successLog = logs.find((l) => l.status_code === 200) as Record<string, unknown>;
    expect(successLog.provider_id).toBe("p2");
    expect(successLog.mapping_reason).toBe("session_affinity");
    expect(successLog.is_failover).toBe(0);
  });

  it("TC2: 模型1 OPEN 被跳过 → 直接走模型2，mapping_reason=circuit_breaker_skip", async () => {
    const p1 = await createControllableBackend({ getStatus: () => 500 });
    const p2 = await createControllableBackend({ getStatus: () => 200 });
    servers.push(p1.server, p2.server);
    setupProvider(db, "p1", `http://127.0.0.1:${p1.port}`);
    setupProvider(db, "p2", `http://127.0.0.1:${p2.port}`);
    setupGroup(db, "gpt-4", [
      { backend_model: "gpt-4", provider_id: "p1", circuit_breaker: cbConfig() },
      { backend_model: "gpt-4", provider_id: "p2", circuit_breaker: cbConfig() },
    ]);
    setupRouterKey(db);
    await buildAppWith(db);

    // 请求1 (sess-prime): t1 fail → CB t1 OPEN → failover t2 success（绑定写 sess-prime，不干扰请求2）
    await sendRequest(app!, "gpt-4", "sess-prime");
    // 请求2 (sess-2 无绑定): t1 skip(OPEN) → 直接 t2
    const resp2 = await sendRequest(app!, "gpt-4", "sess-2");
    expect(resp2.statusCode).toBe(200);

    const logs = getLogs(db);
    // 请求2 只有 1 条日志（t1 被 skip 不产生日志）；取最后一条
    const lastLog = logs[logs.length - 1] as Record<string, unknown>;
    expect(lastLog.provider_id).toBe("p2");
    expect(lastLog.mapping_reason).toBe("circuit_breaker_skip");
    expect(lastLog.is_failover).toBe(0);
  });

  it("TC3: 链上无 CB target → 零行为门控（不写绑定，请求正常）", async () => {
    const p1 = await createControllableBackend({ getStatus: () => 200 });
    servers.push(p1.server);
    setupProvider(db, "p1", `http://127.0.0.1:${p1.port}`);
    // 无 circuit_breaker 配置
    setupGroup(db, "gpt-4", [{ backend_model: "gpt-4", provider_id: "p1" }]);
    setupRouterKey(db);
    await buildAppWith(db);

    const resp = await sendRequest(app!);
    expect(resp.statusCode).toBe(200);
    expect(getBindings(db)).toHaveLength(0);
  });

  it("TC4: 全链 OPEN → 回退真实尝试首个未排除 target（不直接 502）", async () => {
    let p1Status = 500;
    const p1 = await createControllableBackend({ getStatus: () => p1Status });
    const p2 = await createControllableBackend({ getStatus: () => 500 });
    servers.push(p1.server, p2.server);
    setupProvider(db, "p1", `http://127.0.0.1:${p1.port}`);
    setupProvider(db, "p2", `http://127.0.0.1:${p2.port}`);
    setupGroup(db, "gpt-4", [
      { backend_model: "gpt-4", provider_id: "p1", circuit_breaker: cbConfig() },
      { backend_model: "gpt-4", provider_id: "p2", circuit_breaker: cbConfig() },
    ]);
    setupRouterKey(db);
    await buildAppWith(db);

    // 请求1: t1 fail + t2 fail → t1 OPEN, t2 OPEN → 502
    await sendRequest(app!);
    // 请求2: 全链 OPEN → fail-open 回退 cachedTargets[0]=t1（真实尝试）
    p1Status = 200;
    const resp2 = await sendRequest(app!);
    expect(resp2.statusCode).toBe(200);

    const logs = getLogs(db);
    // 请求2 回退真实尝试 t1 → 成功日志 provider_id=p1
    const lastLog = logs[logs.length - 1] as Record<string, unknown>;
    expect(lastLog.provider_id).toBe("p1");
    expect(lastLog.status_code).toBe(200);
  });

  it("TC5: 绑定模型 OPEN → 忽略绑定，走全局链首个非跳过 target", async () => {
    let p1Status = 500;
    const p1 = await createControllableBackend({ getStatus: () => p1Status });
    const p2 = await createControllableBackend({ getStatus: () => 500 });
    servers.push(p1.server, p2.server);
    setupProvider(db, "p1", `http://127.0.0.1:${p1.port}`);
    setupProvider(db, "p2", `http://127.0.0.1:${p2.port}`);
    setupGroup(db, "gpt-4", [
      // t1: min_samples=5 不易 OPEN（请求中只 fail 1~2 次）
      { backend_model: "gpt-4", provider_id: "p1", circuit_breaker: cbConfig({ min_samples: 5, failure_rate: 0.9 }) },
      // t2: min_samples=1，1 次失败即 OPEN
      { backend_model: "gpt-4", provider_id: "p2", circuit_breaker: cbConfig() },
    ]);
    setupRouterKey(db);
    await buildAppWith(db);

    // 请求1 (sess-prime): t1(500) → CB t1 1fail(<5) → failover t2(500) → CB t2 OPEN → 502
    await sendRequest(app!, "gpt-4", "sess-prime");
    // 预置 sess-1 绑定到 t2（已 OPEN）
    insertBinding(db, "mg-gpt-4", "p2", "gpt-4", "sess-1");
    // p1 恢复 200
    p1Status = 200;
    // 请求2 (sess-1): 绑定 t2 但 OPEN → 忽略绑定 → skip t2 → 走 t1(200)
    const resp2 = await sendRequest(app!, "gpt-4", "sess-1");
    expect(resp2.statusCode).toBe(200);

    const logs = getLogs(db);
    const lastLog = logs[logs.length - 1] as Record<string, unknown>;
    expect(lastLog.provider_id).toBe("p1");
  });

  it("TC6: 成功请求 → 首次绑定写入（条件①）", async () => {
    const p1 = await createControllableBackend({ getStatus: () => 200 });
    servers.push(p1.server);
    setupProvider(db, "p1", `http://127.0.0.1:${p1.port}`);
    setupProvider(db, "p2", "http://127.0.0.1:9"); // 未监听，不会被调用
    setupGroup(db, "gpt-4", [
      { backend_model: "gpt-4", provider_id: "p1", circuit_breaker: cbConfig() },
      { backend_model: "gpt-4", provider_id: "p2" },
    ]);
    setupRouterKey(db);
    await buildAppWith(db);

    const resp = await sendRequest(app!);
    expect(resp.statusCode).toBe(200);

    const bindings = getBindings(db);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].provider_id).toBe("p1");
    expect(bindings[0].current_model).toBe("gpt-4");
    expect(bindings[0].group_id).toBe("mg-gpt-4");
  });

  it("TC7: 成功模型==绑定模型 → 刷新 last_active_at（条件②）", async () => {
    const p1 = await createControllableBackend({ getStatus: () => 200 });
    servers.push(p1.server);
    setupProvider(db, "p1", `http://127.0.0.1:${p1.port}`);
    setupGroup(db, "gpt-4", [
      { backend_model: "gpt-4", provider_id: "p1", circuit_breaker: cbConfig() },
      { backend_model: "gpt-4", provider_id: "p1" },
    ]);
    setupRouterKey(db);
    // 预置绑定（旧 last_active_at）
    const oldTime = new Date(Date.now() - 100000).toISOString();
    db.prepare(
      `INSERT INTO session_model_states (id, router_key_id, session_id, group_id, current_model, original_model, provider_id, last_active_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("bind-old", "rk-1", SESSION_ID, "mg-gpt-4", "gpt-4", "gpt-4", "p1", oldTime, oldTime);
    await buildAppWith(db);

    const resp = await sendRequest(app!);
    expect(resp.statusCode).toBe(200);

    const bindings = getBindings(db);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].last_active_at).not.toBe(oldTime);
  });

  // ========== TC8-TC10: 计数细节 ==========

  it("TC8: provider 不可用例外路径计入 fail（累计 OPEN 后被跳过）", async () => {
    const p2 = await createControllableBackend({ getStatus: () => 200 });
    servers.push(p2.server);
    setupProvider(db, "p2", `http://127.0.0.1:${p2.port}`);
    // p1 不插入（provider 不存在）→ 例外路径
    setupGroup(db, "gpt-4", [
      { backend_model: "gpt-4", provider_id: "p1", circuit_breaker: cbConfig() },
      { backend_model: "gpt-4", provider_id: "p2", circuit_breaker: cbConfig() },
    ]);
    setupRouterKey(db);
    await buildAppWith(db);

    // 请求1 (sess-prime): t1 provider 不可用 → 例外路径记 fail → CB t1 OPEN → failover t2 success
    await sendRequest(app!, "gpt-4", "sess-prime");
    // 请求2 (sess-2 无绑定): t1 OPEN skip → t2
    const resp2 = await sendRequest(app!, "gpt-4", "sess-2");
    expect(resp2.statusCode).toBe(200);

    const logs = getLogs(db);
    const lastLog = logs[logs.length - 1] as Record<string, unknown>;
    expect(lastLog.provider_id).toBe("p2");
    expect(lastLog.mapping_reason).toBe("circuit_breaker_skip");
  });

  it("TC9: throw（连接级错误）计入 fail，不受白名单限制", async () => {
    const p2 = await createControllableBackend({ getStatus: () => 200 });
    servers.push(p2.server);
    setupProvider(db, "p2", `http://127.0.0.1:${p2.port}`);
    // p1 指向未监听端口 → ECONNREFUSED（throw）
    setupProvider(db, "p1", "http://127.0.0.1:1");
    setupGroup(db, "gpt-4", [
      { backend_model: "gpt-4", provider_id: "p1", circuit_breaker: cbConfig({ status_codes: [500] }) },
      { backend_model: "gpt-4", provider_id: "p2", circuit_breaker: cbConfig() },
    ]);
    setupRouterKey(db);
    await buildAppWith(db);

    // 请求1 (sess-prime): t1 throw(ECONNREFUSED) → CB 记 fail（throw 不受白名单）→ failover t2 success
    await sendRequest(app!, "gpt-4", "sess-prime");
    // 请求2 (sess-2 无绑定): t1 OPEN（throw 计入的）skip → t2
    const resp2 = await sendRequest(app!, "gpt-4", "sess-2");
    expect(resp2.statusCode).toBe(200);

    const logs = getLogs(db);
    const lastLog = logs[logs.length - 1] as Record<string, unknown>;
    expect(lastLog.provider_id).toBe("p2");
    expect(lastLog.mapping_reason).toBe("circuit_breaker_skip");
  });

  it("TC10: status_codes 白名单外失败不计入（不触发 OPEN）", async () => {
    const p1 = await createControllableBackend({ getStatus: () => 418 });
    const p2 = await createControllableBackend({ getStatus: () => 200 });
    servers.push(p1.server, p2.server);
    setupProvider(db, "p1", `http://127.0.0.1:${p1.port}`);
    setupProvider(db, "p2", `http://127.0.0.1:${p2.port}`);
    setupGroup(db, "gpt-4", [
      // status_codes=[500]，418 不在白名单 → 不计入
      { backend_model: "gpt-4", provider_id: "p1", circuit_breaker: cbConfig({ status_codes: [500] }) },
      { backend_model: "gpt-4", provider_id: "p2", circuit_breaker: cbConfig() },
    ]);
    setupRouterKey(db);
    await buildAppWith(db);

    // 请求1 (sess-prime): t1 418（白名单外，不计）→ failover t2 success
    await sendRequest(app!, "gpt-4", "sess-prime");
    // 请求2 (sess-2 无绑定): t1 未 OPEN（未计数）→ 仍真实尝试 t1（418）
    const resp2 = await sendRequest(app!, "gpt-4", "sess-2");
    expect(resp2.statusCode).toBe(200);

    const logs = getLogs(db);
    // 请求2 应有 provider_id=p1 的日志（t1 未被 skip，真实尝试 418）
    const req2P1Log = logs.find((l, i) => i >= logs.length - 2 && l.provider_id === "p1");
    // 强断言：不仅存在，且是真实尝试的 418（证明未被 CB skip）
    expect(req2P1Log?.status_code).toBe(418);
  });

  // ========== TC11-TC12: group 绑定 ==========

  it("TC11: 同 session 多 group 交替成功 → 各 group 独立绑定互不覆写", async () => {
    const p1 = await createControllableBackend({ getStatus: () => 200 });
    const p2 = await createControllableBackend({ getStatus: () => 200 });
    servers.push(p1.server, p2.server);
    setupProvider(db, "p1", `http://127.0.0.1:${p1.port}`);
    setupProvider(db, "p2", `http://127.0.0.1:${p2.port}`);
    setupGroup(db, "gpt-4", [{ backend_model: "gpt-4", provider_id: "p1", circuit_breaker: cbConfig() }]);
    setupGroup(db, "claude", [{ backend_model: "claude-3", provider_id: "p2", circuit_breaker: cbConfig() }]);
    setupRouterKey(db);
    await buildAppWith(db);

    await sendRequest(app!, "gpt-4");
    await sendRequest(app!, "claude");

    const bindings = getBindings(db);
    expect(bindings).toHaveLength(2);
    const gpt4Binding = bindings.find((b) => b.group_id === "mg-gpt-4");
    const claudeBinding = bindings.find((b) => b.group_id === "mg-claude");
    expect(gpt4Binding?.provider_id).toBe("p1");
    expect(gpt4Binding?.current_model).toBe("gpt-4");
    expect(claudeBinding?.provider_id).toBe("p2");
    expect(claudeBinding?.current_model).toBe("claude-3");
  });

  it("TC12: 绑定模型不在配置级集合 → 忽略绑定，成功后覆盖为新模型（条件③）", async () => {
    const p1 = await createControllableBackend({ getStatus: () => 200 });
    servers.push(p1.server);
    setupProvider(db, "p1", `http://127.0.0.1:${p1.port}`);
    setupGroup(db, "gpt-4", [
      { backend_model: "gpt-4", provider_id: "p1", circuit_breaker: cbConfig() },
    ]);
    setupRouterKey(db);
    // 预置绑定到已不存在的模型（p_old/gpt-old 不在配置集合）
    insertBinding(db, "mg-gpt-4", "p_old", "gpt-old");
    await buildAppWith(db);

    const resp = await sendRequest(app!);
    expect(resp.statusCode).toBe(200);

    const bindings = getBindings(db);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].provider_id).toBe("p1");
    expect(bindings[0].current_model).toBe("gpt-4");
  });

  // ========== TC13-TC15: 留痕 / 回退单次性 / provider 停用 ==========

  it("TC13: 混合场景 [t1,t2]，t2 OPEN；t1 失败后回退到 t2（序列 [t1,t2] 非 [t1,t1]）", async () => {
    let p1Status = 500;
    let p2Status = 500;
    let p1Calls = 0;
    let p2Calls = 0;
    const p1 = await createControllableBackend({ getStatus: () => p1Status, onCall: () => { p1Calls++; } });
    const p2 = await createControllableBackend({ getStatus: () => p2Status, onCall: () => { p2Calls++; } });
    servers.push(p1.server, p2.server);
    setupProvider(db, "p1", `http://127.0.0.1:${p1.port}`);
    setupProvider(db, "p2", `http://127.0.0.1:${p2.port}`);
    setupGroup(db, "gpt-4", [
      // t1: min_samples=5 不易 OPEN（请求中只 fail 1~2 次）
      { backend_model: "gpt-4", provider_id: "p1", circuit_breaker: cbConfig({ min_samples: 5, failure_rate: 0.9 }) },
      // t2: min_samples=1，1 次失败即 OPEN
      { backend_model: "gpt-4", provider_id: "p2", circuit_breaker: cbConfig() },
    ]);
    setupRouterKey(db);
    await buildAppWith(db);

    // 请求1 (sess-prime): t1(500) → t2(500) → t2 OPEN（t1 记 1 fail <5 不 OPEN）→ 502
    await sendRequest(app!, "gpt-4", "sess-prime");
    // 恢复 p2 为 200（回退时真实尝试应成功）
    p2Status = 200;
    // 请求2 (sess-verify 无绑定):
    //   迭代1: t1(500) 真实尝试(t1未OPEN) → fail → exclude[t1]
    //   迭代2: filtered=[t2], skip t2(OPEN) → 空 → fail-open 回退 filterExcluded[0]=t2 → 真实 t2(200)
    const callsBefore = { p1: p1Calls, p2: p2Calls };
    const resp = await sendRequest(app!, "gpt-4", "sess-verify");
    expect(resp.statusCode).toBe(200);
    // t1 真实尝试 1 次（迭代1），t2 真实尝试 1 次（回退，非重复 t1）
    expect(p1Calls - callsBefore.p1).toBe(1);
    expect(p2Calls - callsBefore.p2).toBe(1);
  });

  it("TC14: 回退单次性 — 全链 OPEN 回退失败后直接 502（不二次回退）", async () => {
    const p1 = await createControllableBackend({ getStatus: () => 500 });
    const p2 = await createControllableBackend({ getStatus: () => 500 });
    servers.push(p1.server, p2.server);
    setupProvider(db, "p1", `http://127.0.0.1:${p1.port}`);
    setupProvider(db, "p2", `http://127.0.0.1:${p2.port}`);
    setupGroup(db, "gpt-4", [
      { backend_model: "gpt-4", provider_id: "p1", circuit_breaker: cbConfig() },
      { backend_model: "gpt-4", provider_id: "p2", circuit_breaker: cbConfig() },
    ]);
    setupRouterKey(db);
    await buildAppWith(db);

    // 请求1: t1+t2 全 fail → 全 OPEN → 502
    await sendRequest(app!);
    // 请求2: 全链 OPEN → 回退 t1(500) fail → exclude[t1] → 迭代2 skip t2 + failOpenUsed → 直接 502
    let p1Calls = 0;
    p1.server.removeAllListeners("request");
    p1.server.on("request", (_req, res) => {
      p1Calls++;
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "err", type: "server_error" } }));
    });
    const resp2 = await sendRequest(app!);
    expect(resp2.statusCode).toBe(502);
    // 回退仅真实尝试 t1 一次（单次性，不二次回退到 t2）
    expect(p1Calls).toBe(1);
  });

  it("TC15: 绑定模型 provider 停用 → 视为失效，成功后覆盖绑定（条件③b）", async () => {
    const p2 = await createControllableBackend({ getStatus: () => 200 });
    servers.push(p2.server);
    setupProvider(db, "p2", `http://127.0.0.1:${p2.port}`);
    // p1 存在但停用
    setupProvider(db, "p1", "http://127.0.0.1:9", 0);
    setupGroup(db, "gpt-4", [
      { backend_model: "gpt-4", provider_id: "p1", circuit_breaker: cbConfig() },
      { backend_model: "gpt-4", provider_id: "p2", circuit_breaker: cbConfig() },
    ]);
    setupRouterKey(db);
    // 预置绑定到 t1（p1 已停用）
    insertBinding(db, "mg-gpt-4", "p1", "gpt-4");
    await buildAppWith(db);

    const resp = await sendRequest(app!);
    expect(resp.statusCode).toBe(200);

    const bindings = getBindings(db);
    expect(bindings).toHaveLength(1);
    // 绑定从 t1（停用）覆盖为 t2
    expect(bindings[0].provider_id).toBe("p2");
    expect(bindings[0].current_model).toBe("gpt-4");
  });

  it("TC16: overflow 绑定不被普通请求劫持（§3 条件③ 配置级基准）", async () => {
    const p1 = await createControllableBackend({ getStatus: () => 200 });
    const p2 = await createControllableBackend({ getStatus: () => 200 });
    servers.push(p1.server, p2.server);
    setupProvider(db, "p1", `http://127.0.0.1:${p1.port}`);
    setupProvider(db, "p2", `http://127.0.0.1:${p2.port}`);
    setupProvider(db, "ov_p", "http://127.0.0.1:9"); // overflow 目标 provider（普通请求不会调用）
    setupGroup(db, "gpt-4", [
      // t1 配 CB（门控：链上有 CB target 才启用绑定机制）
      { backend_model: "gpt-4", provider_id: "p1", circuit_breaker: cbConfig() },
      // t2 配 overflow 目标 ov_p:ov_m
      { backend_model: "gpt-4", provider_id: "p2", overflow_provider_id: "ov_p", overflow_model: "ov_m" },
    ]);
    setupRouterKey(db);
    // 预置绑定到 overflow 目标（模拟之前一次 overflow 请求建立的绑定）
    insertBinding(db, "mg-gpt-4", "ov_p", "ov_m");
    await buildAppWith(db);

    // 普通请求（body 小，不触发 overflow）→ 运行时链 [t1, t2]，绑定 ov_p:ov_m 不在链上 → 绑定不前移，走 t1
    const resp = await sendRequest(app!);
    expect(resp.statusCode).toBe(200);

    // 断言：绑定不被覆盖——ov_p:ov_m 仍在 configLevelTargetKeys 中（含 overflow 扩展目标），条件③ 不失效
    const bindings = getBindings(db);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].provider_id).toBe("ov_p");
    expect(bindings[0].current_model).toBe("ov_m");
  });

  // ========== TC17-TC19: §4.5 例外路径计数 / overflow 排序 / 回退成功绑定（设计文档 §10 补全）==========

  it("TC17 (T3): provider 停用的 503 continue 路径计入 fail → 累计达标后 OPEN，后续请求跳过（§4.5 行2）", async () => {
    // 设计文档 §4.5：provider 不可用（is_active=0）在 failover-loop continue 点计入 fail（不经 processResilienceResult）
    // 本测试验证：反复请求一个首个 target 停用的 group，该 target 的 CB 状态应累计 fail 直至 OPEN
    const p2 = await createControllableBackend({ getStatus: () => 200 });
    servers.push(p2.server);
    setupProvider(db, "p1", "http://127.0.0.1:9", 0); // p1 停用→每次请求都走 503 continue 路径
    setupProvider(db, "p2", `http://127.0.0.1:${p2.port}`);
    setupGroup(db, "gpt-4", [
      { backend_model: "gpt-4", provider_id: "p1", circuit_breaker: cbConfig() }, // min_samples=1
      { backend_model: "gpt-4", provider_id: "p2" },
    ]);
    setupRouterKey(db);
    await buildAppWith(db);

    // 请求1 (sess-prime): t1(p1停用→503 continue 计 fail) → t2 success（用独立 session 避免绑定干扰）
    const r1 = await sendRequest(app!, "gpt-4", "sess-prime");
    expect(r1.statusCode).toBe(200);
    // 请求2 (sess-verify 无绑定): t1 应已 OPEN（1 次 503 continue 计入即可，min_samples=1）→ skip → 直接走 t2
    const r2 = await sendRequest(app!, "gpt-4", "sess-verify");
    expect(r2.statusCode).toBe(200);

    const logs = getLogs(db);
    // 请求2 应体现 circuit_breaker_skip（证明 503 continue 路径的计数已使 t1 OPEN）
    const req2Log = logs[logs.length - 1] as Record<string, unknown>;
    expect(req2Log.mapping_reason).toBe("circuit_breaker_skip");
    expect(req2Log.provider_id).toBe("p2");
  });

  it("TC18 (T4): 绑定模型同时配 overflow，超限请求先走 overflow 目标（绑定优先不越过 overflow 预置）(§5.3 步骤2)", async () => {
    // 设计文档 §5.3 步骤2：绑定模型前移不得越过 overflow 预置目标
    let overflowCalled = false;
    let bindingCalled = false;
    const overflowBackend = await createControllableBackend({
      getStatus: () => 200,
      onCall: () => { overflowCalled = true; },
    });
    const bindingBackend = await createControllableBackend({
      getStatus: () => 200,
      onCall: () => { bindingCalled = true; },
    });
    servers.push(overflowBackend.server, bindingBackend.server);
    setupProvider(db, "ov_p", `http://127.0.0.1:${overflowBackend.port}`);
    setupProvider(db, "p1", `http://127.0.0.1:${bindingBackend.port}`);
    setupGroup(db, "gpt-4", [
      // t1 = 绑定模型，同时配 overflow 目标 ov_p:ov_m
      { backend_model: "gpt-4", provider_id: "p1", overflow_provider_id: "ov_p", overflow_model: "ov_m", circuit_breaker: cbConfig() },
      { backend_model: "gpt-4", provider_id: "p1" },
    ]);
    setupRouterKey(db);
    // 预置绑定到 t1（绑定模型自身配 overflow）
    insertBinding(db, "mg-gpt-4", "p1", "gpt-4");
    await buildAppWith(db);

    // 超限请求：context 超大→触发 overflow 扩展。overflow 预置目标应先于绑定模型被调用
    const hugeBody = JSON.stringify({
      model: "gpt-4",
      messages: [{ role: "user", content: "x".repeat(500_000) }], // 远超阈值触发 overflow
      max_tokens: 1,
    });
    const resp = await app!.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}`, [SESSION_HEADER]: SESSION_ID },
      payload: JSON.parse(hugeBody),
    });
    expect(resp.statusCode).toBe(200);

    // 断言：overflow 目标被调用（证明绑定未越过 overflow 预置）
    expect(overflowCalled).toBe(true);
    // 绑定模型未被调用（overflow 成功后不走绑定模型）
    expect(bindingCalled).toBe(false);
  });

  it("TC19 (T6): 全链 OPEN 回退真实尝试首个 target 且成功 → 无绑定场景写绑定至回退目标（§4.4 + §3）", async () => {
    // 设计文档 §10 最后一行：全链 OPEN 回退成功侧的绑定写入行为断言
    let p1Status = 500;
    const p1 = await createControllableBackend({ getStatus: () => p1Status });
    const p2 = await createControllableBackend({ getStatus: () => 500 });
    servers.push(p1.server, p2.server);
    setupProvider(db, "p1", `http://127.0.0.1:${p1.port}`);
    setupProvider(db, "p2", `http://127.0.0.1:${p2.port}`);
    setupGroup(db, "gpt-4", [
      // 两 target 都 min_samples=1，请求1 即可使全链 OPEN
      { backend_model: "gpt-4", provider_id: "p1", circuit_breaker: cbConfig() },
      { backend_model: "gpt-4", provider_id: "p2", circuit_breaker: cbConfig() },
    ]);
    setupRouterKey(db);
    await buildAppWith(db);

    // 请求1 (sess-prime): t1(500)+t2(500) 全 fail → 全 OPEN → 502（不写绑定，失败不写）
    await sendRequest(app!, "gpt-4", "sess-prime");
    // 恢复 p1 为 200（回退真实尝试应成功）
    p1Status = 200;
    // 请求2 (sess-verify 无绑定): 全链 OPEN → fail-open 回退 filterExcluded[0]=t1 → 真实 t1(200) 成功
    const resp = await sendRequest(app!, "gpt-4", "sess-verify");
    expect(resp.statusCode).toBe(200);

    // 断言：回退成功后，无绑定场景按 §3 条件① 写绑定至回退目标 t1（DB 行断言）
    const bindings = getBindings(db);
    // sess-prime 失败不写绑定；sess-verify 回退成功写 t1 → 共 1 行
    expect(bindings).toHaveLength(1);
    expect(bindings[0].provider_id).toBe("p1");
    expect(bindings[0].current_model).toBe("gpt-4");
    expect(bindings[0].session_id).toBe("sess-verify");
  });
});

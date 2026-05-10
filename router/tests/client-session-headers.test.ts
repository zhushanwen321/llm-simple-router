import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { buildApp } from "../src/index.js";
import { makeConfig, seedSettings, login } from "./helpers/test-setup.js";

import {
  getClientSessionHeaders,
  setClientSessionHeaders,
} from "../src/db/settings.js";
import { clientDetectionHook } from "../src/proxy/hooks/builtin/client-detection.js";
import type { PipelineContext } from "../src/proxy/pipeline/types.js";
import { insertRequestLog } from "../src/db/logs.js";
import { collectTransportMetrics } from "../src/proxy/proxy-logging.js";

const DEFAULT_HEADERS = [
  { client_type: "claude-code", session_header_key: "x-claude-code-session-id" },
  { client_type: "pi", session_header_key: "x-pi-session-id" },
];

// ========== DB 层测试 ==========
describe("getClientSessionHeaders — DB 层", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  it("getClientSessionHeaders 默认值 — 无 setting 行时返回默认配置", () => {
    const result = getClientSessionHeaders(db);
    expect(result).toEqual(DEFAULT_HEADERS);
  });

  it("getClientSessionHeaders 自定义值 — 写入后读取返回自定义配置", () => {
    const custom = [
      { client_type: "cursor", session_header_key: "x-cursor-session-id" },
      { client_type: "windsurf", session_header_key: "x-windsurf-session-id" },
    ];
    setClientSessionHeaders(db, custom);

    const result = getClientSessionHeaders(db);
    expect(result).toEqual(custom);
  });

  it("getClientSessionHeaders 损坏的 JSON — 回退到默认值", () => {
    // 直接在 DB 写入非法 JSON
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "client_session_headers",
      "not-valid-json",
    );

    const result = getClientSessionHeaders(db);
    expect(result).toEqual(DEFAULT_HEADERS);
  });
});

describe("setClientSessionHeaders — DB 层", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  it("setClientSessionHeaders — 写入后 DB 中存储正确的 JSON", () => {
    const entries = [
      { client_type: "my-client", session_header_key: "x-my-session" },
    ];
    setClientSessionHeaders(db, entries);

    // 通过 getSetting 验证原始 DB 存储
    const row = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("client_session_headers") as { value: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.value).toBe(JSON.stringify(entries));
  });

  it("setClientSessionHeaders — 覆盖已有配置", () => {
    const first = [{ client_type: "a", session_header_key: "x-a" }];
    const second = [
      { client_type: "b", session_header_key: "x-b" },
      { client_type: "c", session_header_key: "x-c" },
    ];

    setClientSessionHeaders(db, first);
    setClientSessionHeaders(db, second);

    const result = getClientSessionHeaders(db);
    expect(result).toEqual(second);
    expect(result).toHaveLength(2);
  });

  it("setClientSessionHeaders 空数组 — 应抛错", () => {
    // 先确保正常调用能成功（排除函数未定义导致的假阳性）
    setClientSessionHeaders(db, [{ client_type: "ok", session_header_key: "x-ok" }]);
    // 空数组必须抛错
    expect(() => setClientSessionHeaders(db, [])).toThrow(/at least|empty|invalid/i);
  });
});

// ========== Admin API 测试 ==========
describe("Client Session Headers — Admin API", () => {
  let app: FastifyInstance;
  let close: () => Promise<void>;
  let cookie: string;

  beforeEach(async () => {
    const db = initDatabase(":memory:");
    seedSettings(db);
    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);
  });

  afterEach(async () => {
    await close();
  });

  it("GET /admin/api/settings/client-session-headers — 返回默认配置", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/settings/client-session-headers",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.entries).toEqual(DEFAULT_HEADERS);
  });

  it("PUT /admin/api/settings/client-session-headers — 成功更新后 GET 验证返回新值", async () => {
    const newEntries = [
      { client_type: "cursor", session_header_key: "x-cursor-session-id" },
      { client_type: "cline", session_header_key: "x-cline-session-id" },
      { client_type: "aider", session_header_key: "x-aider-session-id" },
    ];

    const putRes = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/client-session-headers",
      payload: { entries: newEntries },
      headers: { cookie },
    });
    expect(putRes.statusCode).toBe(200);

    // 通过 GET 验证持久化
    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/settings/client-session-headers",
      headers: { cookie },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().data.entries).toEqual(newEntries);
  });

  it("PUT 验证失败 — entries 为空数组 → 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/client-session-headers",
      payload: { entries: [] },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe(40001);
  });

  it("PUT 验证失败 — client_type 为空字符串 → 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/client-session-headers",
      payload: {
        entries: [{ client_type: "", session_header_key: "x-valid" }],
      },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe(40001);
  });

  it("PUT 验证失败 — session_header_key 为空字符串 → 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/client-session-headers",
      payload: {
        entries: [{ client_type: "my-client", session_header_key: "" }],
      },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe(40001);
  });

  it("PUT 验证失败 — client_type 缺失 → 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/client-session-headers",
      payload: {
        entries: [{ session_header_key: "x-valid" }],
      },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT 验证失败 — session_header_key 缺失 → 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/client-session-headers",
      payload: {
        entries: [{ client_type: "my-client" }],
      },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT 验证失败 — entries 不是数组 → 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/admin/api/settings/client-session-headers",
      payload: { entries: "not-an-array" },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("detectClient", () => {
  let detectClient: typeof import("../src/proxy/handler/proxy-handler-utils.js").detectClient;

  beforeAll(async () => {
    const mod = await import("../src/proxy/handler/proxy-handler-utils.js");
    detectClient = mod.detectClient;
  });

  const config = [
    { client_type: "claude-code", session_header_key: "x-claude-code-session-id" },
    { client_type: "pi", session_header_key: "x-pi-session-id" },
  ];

  it("matches client from header", () => {
    const result = detectClient({ "x-claude-code-session-id": "sess-123" }, config);
    expect(result.client_type).toBe("claude-code");
    expect(result.session_id).toBe("sess-123");
  });

  it("matches second client from header", () => {
    const result = detectClient({ "x-pi-session-id": "pi-sess-456" }, config);
    expect(result.client_type).toBe("pi");
    expect(result.session_id).toBe("pi-sess-456");
  });

  it("returns unknown when no header matches", () => {
    const result = detectClient({}, config);
    expect(result.client_type).toBe("unknown");
    expect(result.session_id).toBeUndefined();
  });

  it("fallback to body when header not present", () => {
    const body = { "x-pi-session-id": "pi-body-sess" };
    const result = detectClient({}, config, body);
    expect(result.client_type).toBe("pi");
    expect(result.session_id).toBe("pi-body-sess");
  });

  it("header takes priority over body", () => {
    const headers = { "x-pi-session-id": "header-sess" };
    const body = { "x-pi-session-id": "body-sess" };
    const result = detectClient(headers, config, body);
    expect(result.session_id).toBe("header-sess");
  });

  it("body with non-string value does not match", () => {
    const body = { "x-pi-session-id": 12345 };
    const result = detectClient({}, config, body);
    expect(result.client_type).toBe("unknown");
  });

  it("undefined body does not crash", () => {
    const result = detectClient({}, config, undefined);
    expect(result.client_type).toBe("unknown");
    expect(result.session_id).toBeUndefined();
  });
});

// ========== Pipeline Hook 集成测试：DB 配置驱动 ==========

function createPipelineContext(
  headers: Record<string, string>,
  body?: Record<string, unknown>,
  db?: Database.Database,
): PipelineContext {
  const metadata = new Map<string, unknown>();
  if (db) metadata.set("db", db);
  return {
    request: { headers } as any,
    reply: {} as any,
    rawBody: body ?? {},
    clientModel: "gpt-4",
    apiType: "openai",
    sessionId: undefined,
    body: body ?? {},
    isStream: false,
    resolved: null,
    provider: null,
    effectiveUpstreamPath: "",
    effectiveApiType: "openai",
    injectedHeaders: {},
    metadata,
    logId: "test-log-id",
    rootLogId: null,
    clientRequest: "",
    upstreamRequest: "",
    snapshot: { toJSON: () => "{}" } as any,
    transportResult: null,
    resilienceResult: null,
  };
}

describe("clientDetectionHook — DB 配置驱动集成测试", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("请求带 x-claude-code-session-id header → hook 从 DB 加载默认配置并识别为 claude-code", () => {
    const ctx = createPipelineContext(
      { "x-claude-code-session-id": "cc-sess-e2e" },
      undefined,
      db,
    );
    clientDetectionHook.execute(ctx);

    expect(ctx.metadata.get("client_type")).toBe("claude-code");
    expect(ctx.metadata.get("session_id")).toBe("cc-sess-e2e");
  });

  it("请求带 x-pi-session-id header → hook 识别为 pi", () => {
    const ctx = createPipelineContext(
      { "x-pi-session-id": "pi-sess-e2e" },
      undefined,
      db,
    );
    clientDetectionHook.execute(ctx);

    expect(ctx.metadata.get("client_type")).toBe("pi");
    expect(ctx.metadata.get("session_id")).toBe("pi-sess-e2e");
  });

  it("请求无 session header → client_type 为 unknown，无 session_id", () => {
    const ctx = createPipelineContext(
      { "content-type": "application/json" },
      undefined,
      db,
    );
    clientDetectionHook.execute(ctx);

    expect(ctx.metadata.get("client_type")).toBe("unknown");
    expect(ctx.metadata.has("session_id")).toBe(false);
  });

  it("DB 自定义配置覆盖默认值 → hook 使用新配置匹配", () => {
    setClientSessionHeaders(db, [
      { client_type: "cursor", session_header_key: "x-cursor-session-id" },
    ]);

    const ctx = createPipelineContext(
      { "x-cursor-session-id": "cur-sess-001" },
      undefined,
      db,
    );
    clientDetectionHook.execute(ctx);

    expect(ctx.metadata.get("client_type")).toBe("cursor");
    expect(ctx.metadata.get("session_id")).toBe("cur-sess-001");
  });

  it("DB 自定义配置后，原默认 header 不再被匹配", () => {
    setClientSessionHeaders(db, [
      { client_type: "cursor", session_header_key: "x-cursor-session-id" },
    ]);

    const ctx = createPipelineContext(
      { "x-claude-code-session-id": "cc-sess-001" },
      undefined,
      db,
    );
    clientDetectionHook.execute(ctx);

    // claude-code header 不在新配置中
    expect(ctx.metadata.get("client_type")).toBe("unknown");
  });
});

describe("clientDetectionHook — 配置变更立即生效", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("修改 DB 配置后无需重启，下次 hook 执行即生效", () => {
    // 阶段1：默认配置，pi header 可识别
    const ctx1 = createPipelineContext(
      { "x-pi-session-id": "pi-old" },
      undefined,
      db,
    );
    clientDetectionHook.execute(ctx1);
    expect(ctx1.metadata.get("client_type")).toBe("pi");

    // 修改配置：移除 pi，添加 codex
    setClientSessionHeaders(db, [
      { client_type: "codex", session_header_key: "x-codex-session-id" },
    ]);

    // 阶段2：pi header 不再被识别
    const ctx2 = createPipelineContext(
      { "x-pi-session-id": "pi-new" },
      undefined,
      db,
    );
    clientDetectionHook.execute(ctx2);
    expect(ctx2.metadata.get("client_type")).toBe("unknown");

    // 阶段3：codex header 被新配置识别
    const ctx3 = createPipelineContext(
      { "x-codex-session-id": "codex-sess-001" },
      undefined,
      db,
    );
    clientDetectionHook.execute(ctx3);
    expect(ctx3.metadata.get("client_type")).toBe("codex");
    expect(ctx3.metadata.get("session_id")).toBe("codex-sess-001");
  });

  it("通过 Admin API PUT 修改配置 → hook 立即识别新 client_type", async () => {
    const appDb = initDatabase(":memory:");
    seedSettings(appDb);
    const { app, close } = await buildApp({ config: makeConfig() as any, db: appDb });
    const cookie = await login(app);

    try {
      // 通过 API 添加 codex 配置
      const putRes = await app.inject({
        method: "PUT",
        url: "/admin/api/settings/client-session-headers",
        payload: {
          entries: [
            { client_type: "claude-code", session_header_key: "x-claude-code-session-id" },
            { client_type: "pi", session_header_key: "x-pi-session-id" },
            { client_type: "codex", session_header_key: "x-codex-session-id" },
          ],
        },
        headers: { cookie },
      });
      expect(putRes.statusCode).toBe(200);

      // hook 从同一 DB 读取新配置
      const ctx = createPipelineContext(
        { "x-codex-session-id": "codex-api-sess" },
        undefined,
        appDb,
      );
      clientDetectionHook.execute(ctx);

      expect(ctx.metadata.get("client_type")).toBe("codex");
      expect(ctx.metadata.get("session_id")).toBe("codex-api-sess");
    } finally {
      await close();
    }
  });
});

describe("clientDetectionHook — AC5 端到端验证", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("AC5.3: 新增 codex 配置 → 携带 x-codex-session-id 的请求被识别为 codex", () => {
    // 模拟用户通过 Admin API 添加 codex 条目
    setClientSessionHeaders(db, [
      { client_type: "claude-code", session_header_key: "x-claude-code-session-id" },
      { client_type: "pi", session_header_key: "x-pi-session-id" },
      { client_type: "codex", session_header_key: "x-codex-session-id" },
    ]);

    const ctx = createPipelineContext(
      { "x-codex-session-id": "codex-real-sess" },
      undefined,
      db,
    );
    clientDetectionHook.execute(ctx);

    expect(ctx.metadata.get("client_type")).toBe("codex");
    expect(ctx.metadata.get("session_id")).toBe("codex-real-sess");
  });

  it("AC5.4: 只有 User-Agent 含 pi-coding-agent（无 session header）→ 不被识别，为 unknown", () => {
    // 默认配置下
    const ctx = createPipelineContext(
      { "user-agent": "pi-coding-agent/1.0.0" },
      undefined,
      db,
    );
    clientDetectionHook.execute(ctx);

    // User-Agent 匹配不再作为识别手段
    expect(ctx.metadata.get("client_type")).toBe("unknown");
    expect(ctx.metadata.has("session_id")).toBe(false);
  });

  it("AC5.1: Claude Code 请求（带 x-claude-code-session-id）→ 正确识别", () => {
    const ctx = createPipelineContext(
      { "x-claude-code-session-id": "cc-real-session" },
      undefined,
      db,
    );
    clientDetectionHook.execute(ctx);

    expect(ctx.metadata.get("client_type")).toBe("claude-code");
    expect(ctx.metadata.get("session_id")).toBe("cc-real-session");
  });

  it("AC5.2: Pi 请求（带 x-pi-session-id）→ 正确识别", () => {
    const ctx = createPipelineContext(
      { "x-pi-session-id": "pi-real-session" },
      undefined,
      db,
    );
    clientDetectionHook.execute(ctx);

    expect(ctx.metadata.get("client_type")).toBe("pi");
    expect(ctx.metadata.get("session_id")).toBe("pi-real-session");
  });
});

describe("clientDetectionHook → collectTransportMetrics 联动", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("hook 识别的 client_type 写入 request_metrics", () => {
    const logId = "e2e-log-001";
    insertRequestLog(db, {
      id: logId,
      api_type: "openai",
      model: "gpt-4",
      provider_id: "p1",
      status_code: 200,
      latency_ms: 100,
      is_stream: 1,
      error_message: null,
      created_at: new Date().toISOString(),
    });

    // 模拟 hook 设置的 metadata
    const clientType = "claude-code";
    const sessionId = "cc-e2e-sess";

    collectTransportMetrics(
      db,
      "openai",
      {
        kind: "stream_success",
        statusCode: 200,
        metrics: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          ttft_ms: 50,
          total_duration_ms: 200,
          tokens_per_second: 25,
          stop_reason: "stop",
          is_complete: 1,
          thinking_tokens: null,
          text_tokens: null,
          tool_use_tokens: null,
        } as any,
        sentHeaders: {},
      },
      true,
      logId,
      "p1",
      "gpt-4",
      { body: { messages: [{ role: "user", content: "hi" }] }, log: { error: () => {} } } as any,
      null,
      200,
      clientType,
      sessionId,
    );

    const rows = db
      .prepare("SELECT * FROM request_metrics WHERE request_log_id = ?")
      .all(logId) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].client_type).toBe("claude-code");
  });

  it("unknown client_type 正确记录到 metrics", () => {
    const logId = "e2e-log-002";
    insertRequestLog(db, {
      id: logId,
      api_type: "openai",
      model: "gpt-4",
      provider_id: "p1",
      status_code: 200,
      latency_ms: 50,
      is_stream: 0,
      error_message: null,
      created_at: new Date().toISOString(),
    });

    collectTransportMetrics(
      db,
      "openai",
      {
        kind: "success",
        statusCode: 200,
        body: JSON.stringify({ model: "gpt-4", usage: { prompt_tokens: 5, completion_tokens: 3 } }),
        headers: {},
        sentHeaders: {},
        sentBody: "",
      } as any,
      false,
      logId,
      "p1",
      "gpt-4",
      { body: {}, log: { error: () => {} } } as any,
      null,
      200,
      "unknown",
      undefined,
    );

    const rows = db
      .prepare("SELECT * FROM request_metrics WHERE request_log_id = ?")
      .all(logId) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].client_type).toBe("unknown");
  });
});

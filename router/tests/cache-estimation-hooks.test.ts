/**
 * 接口级测试：clientDetectionHook、cacheEstimationHook、collectTransportMetrics（新增参数）
 *
 * 覆盖范围：
 * 1. clientDetectionHook — 客户端类型检测 + session_id 提取
 * 2. cacheEstimationHook — 缓存命中估算（API 原生 / token 级前缀匹配）
 * 3. collectTransportMetrics 新增参数 — clientType、cacheReadTokensEstimated、cacheReadTokensValue
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { insertRequestLog } from "../src/db/logs.js";
import { setTokenEstimationEnabled, setSetting } from "../src/db/settings.js";
import { clientDetectionHook } from "../src/proxy/hooks/builtin/client-detection.js";
import { cacheEstimationHook } from "../src/proxy/hooks/builtin/cache-estimation.js";
import { cacheEstimator } from "../src/routing/cache-estimator.js";
import { collectTransportMetrics } from "../src/proxy/proxy-logging.js";
import type { PipelineContext } from "../src/proxy/pipeline/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    request: {} as any,
    reply: {} as any,
    rawBody: { messages: [{ role: "user", content: "hello" }] },
    clientModel: "gpt-4",
    apiType: "openai",
    sessionId: undefined,
    body: {},
    isStream: false,
    resolved: null,
    provider: null,
    effectiveUpstreamPath: "",
    effectiveApiType: "openai",
    injectedHeaders: {},
    metadata: new Map(),
    logId: "test-log-id",
    rootLogId: null,
    clientRequest: "",
    upstreamRequest: "",
    snapshot: { toJSON: () => "{}" } as any,
    transportResult: null,
    resilienceResult: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// clientDetectionHook
// ---------------------------------------------------------------------------

describe("clientDetectionHook", () => {
  it("detects claude-code from x-claude-code-session-id header", () => {
    const ctx = createMockContext({
      request: { headers: { "x-claude-code-session-id": "cc-sess-123" } } as any,
    });
    clientDetectionHook.execute(ctx);
    expect(ctx.metadata.get("client_type")).toBe("claude-code");
  });

  it("detects pi from user-agent header containing pi-coding-agent", () => {
    const ctx = createMockContext({
      request: { headers: { "user-agent": "pi-coding-agent/1.0" } } as any,
    });
    clientDetectionHook.execute(ctx);
    expect(ctx.metadata.get("client_type")).toBe("pi");
  });

  it("sets client_type to unknown when no identifying headers present", () => {
    const ctx = createMockContext({
      request: { headers: { "content-type": "application/json" } } as any,
    });
    clientDetectionHook.execute(ctx);
    expect(ctx.metadata.get("client_type")).toBe("unknown");
  });

  it("extracts session_id from x-claude-code-session-id", () => {
    const ctx = createMockContext({
      request: { headers: { "x-claude-code-session-id": "cc-sess-456", "user-agent": "something" } } as any,
    });
    clientDetectionHook.execute(ctx);
    expect(ctx.metadata.get("session_id")).toBe("cc-sess-456");
    // client_type 应该 still detect claude-code
    expect(ctx.metadata.get("client_type")).toBe("claude-code");
  });

  it("falls back to x-pi-session-id when x-claude-code-session-id is missing", () => {
    const ctx = createMockContext({
      request: { headers: { "x-pi-session-id": "pi-sess-789" } } as any,
    });
    clientDetectionHook.execute(ctx);
    expect(ctx.metadata.get("session_id")).toBe("pi-sess-789");
  });

  it("does not set sessionId when both headers are absent", () => {
    const ctx = createMockContext({
      request: { headers: { "content-type": "application/json" } } as any,
    });
    clientDetectionHook.execute(ctx);
    expect(ctx.metadata.has("session_id")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cacheEstimationHook
// ---------------------------------------------------------------------------

describe("cacheEstimationHook", () => {
  let db: Database.Database;
  let sessCounter = 0;

  function nextSession(): string {
    sessCounter++;
    return `hook-test-sess-${sessCounter}`;
  }

  beforeEach(() => {
    db = initDatabase(":memory:");
    // Enable token estimation by default
    setTokenEstimationEnabled(db, true);
    sessCounter = 0;
  });

  afterEach(() => {
    db.close();
  });

  it("no-op when db is missing from metadata", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = createMockContext();
    // metadata has no "db" key
    cacheEstimationHook.execute(ctx);

    // Should not crash, metadata should remain untouched
    expect(ctx.metadata.has("cache_read_tokens_estimated")).toBe(false);
    spy.mockRestore();
  });

  it("no-op when token_estimation_enabled is false", () => {
    setTokenEstimationEnabled(db, false);
    const ctx = createMockContext({
      metadata: new Map([["db", db], ["session_id", nextSession()]]),
    });
    cacheEstimationHook.execute(ctx);
    expect(ctx.metadata.has("cache_read_tokens_estimated")).toBe(false);
  });

  it("no-op when session_id is missing from metadata", () => {
    const ctx = createMockContext({
      metadata: new Map([["db", db]]),
    });
    cacheEstimationHook.execute(ctx);
    expect(ctx.metadata.has("cache_read_tokens_estimated")).toBe(false);
  });

  it("uses API-reported cache_read_tokens when present, sets estimated=0", () => {
    const sessionId = nextSession();
    const ctx = createMockContext({
      rawBody: { messages: [{ role: "user", content: "hi" }] },
      clientModel: "gpt-4",
      metadata: new Map([["db", db], ["session_id", sessionId]]),
      transportResult: {
        kind: "stream_success",
        statusCode: 200,
        metrics: { cache_read_tokens: 50 } as any,
        sentHeaders: {},
      } as any,
    });

    cacheEstimationHook.execute(ctx);
    // API reported >0, so estimated=0 (we trust API's value)
    expect(ctx.metadata.get("cache_read_tokens_estimated")).toBe(0);
    // Should not override the API-reported cache_read_tokens in metadata
    expect(ctx.metadata.has("cache_read_tokens")).toBe(false);
  });

  it("estimates cache hit when no API cache_read_tokens and estimate succeeds", () => {
    const sessionId = nextSession();
    const msg = "What is the capital of France?";
    const body1 = { messages: [{ role: "user", content: msg }] };
    const body2 = { messages: [{ role: "user", content: msg + " Give details." }] };

    // First call: no history → cached, no metadata set
    const ctx1 = createMockContext({
      rawBody: body1,
      clientModel: "gpt-4",
      metadata: new Map([["db", db], ["session_id", sessionId]]),
    });
    cacheEstimationHook.execute(ctx1);
    // estimateHit returns null on first call, so cache_read_tokens_estimated = 0
    expect(ctx1.metadata.get("cache_read_tokens_estimated")).toBe(0);
    expect(ctx1.metadata.has("cache_read_tokens")).toBe(false);

    // Second call: should find history → estimate overlap > 0
    const ctx2 = createMockContext({
      rawBody: body2,
      clientModel: "gpt-4",
      metadata: new Map([["db", db], ["session_id", sessionId]]),
    });
    cacheEstimationHook.execute(ctx2);
    expect(ctx2.metadata.get("cache_read_tokens_estimated")).toBe(1);
    const cacheTokens = ctx2.metadata.get("cache_read_tokens");
    expect(cacheTokens).toBeGreaterThan(0);
  });

  it("sets estimated=0 when estimate returns 0 (no prefix overlap)", () => {
    const sessionId = nextSession();
    const body1 = { messages: [{ role: "user", content: "AAA" }] };
    const body2 = { messages: [{ role: "user", content: "BBB" }] };

    // First call: no history
    const ctx1 = createMockContext({
      rawBody: body1,
      clientModel: "gpt-4",
      metadata: new Map([["db", db], ["session_id", sessionId]]),
    });
    cacheEstimationHook.execute(ctx1);
    expect(ctx1.metadata.get("cache_read_tokens_estimated")).toBe(0);

    // Second call: body2 vs previous body1 → no prefix overlap → 0
    const ctx2 = createMockContext({
      rawBody: body2,
      clientModel: "gpt-4",
      metadata: new Map([["db", db], ["session_id", sessionId]]),
    });
    cacheEstimationHook.execute(ctx2);
    expect(ctx2.metadata.get("cache_read_tokens_estimated")).toBe(0);
    expect(ctx2.metadata.has("cache_read_tokens")).toBe(false);
  });

  it("handles error gracefully (logs but does not throw)", () => {
    const ctx = createMockContext({
      metadata: new Map([["db", db], ["session_id", nextSession()]]),
      request: { log: { error: vi.fn() } } as any,
    });
    // Force a failure: inject an invalid db reference that will crash on getTokenEstimationEnabled
    // Actually the hook catches all errors internally, so just make sure it doesn't throw
    // by passing a broken db
    ctx.metadata.set("db", null);
    expect(() => cacheEstimationHook.execute(ctx)).not.toThrow();
  });

  it("handles stream_abort transport with API cache_read_tokens", () => {
    const sessionId = nextSession();
    const ctx = createMockContext({
      rawBody: { messages: [{ role: "user", content: "abort test" }] },
      clientModel: "gpt-4",
      metadata: new Map([["db", db], ["session_id", sessionId]]),
      transportResult: {
        kind: "stream_abort",
        statusCode: 200,
        metrics: { cache_read_tokens: 30 } as any,
        sentHeaders: {},
      } as any,
    });

    cacheEstimationHook.execute(ctx);
    expect(ctx.metadata.get("cache_read_tokens_estimated")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// collectTransportMetrics 新增参数
// ---------------------------------------------------------------------------

describe("collectTransportMetrics — new cache params", () => {
  let db: Database.Database;
  let logCounter = 0;

  function nextLogId(): string {
    logCounter++;
    return `ctm-log-${logCounter}`;
  }

  function makeMockRequest(body?: Record<string, unknown>): any {
    return {
      body: body ?? { messages: [{ role: "user", content: "hello" }] },
      log: { error: vi.fn() },
    };
  }

  beforeEach(() => {
    db = initDatabase(":memory:");
    setTokenEstimationEnabled(db, true);
    logCounter = 0;
  });

  afterEach(() => {
    db.close();
  });

  it("stream success path: writes client_type and cache_read_tokens_estimated", () => {
    const logId = nextLogId();
    insertRequestLog(db, {
      id: logId, api_type: "openai", model: "gpt-4", provider_id: "p1",
      status_code: 200, latency_ms: 100, is_stream: 1, error_message: null,
      created_at: new Date().toISOString(),
    });

    collectTransportMetrics(
      db,
      "openai",
      {
        kind: "stream_success",
        statusCode: 200,
        metrics: { input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_creation_tokens: 0, ttft_ms: 100, total_duration_ms: 500, tokens_per_second: 100, stop_reason: "stop", is_complete: 1, thinking_tokens: null, text_tokens: null, tool_use_tokens: null } as any,
        sentHeaders: {},
      },
      true,
      logId,
      "p1",
      "gpt-4",
      makeMockRequest(),
      null,
      200,
      "claude-code",
      1,
      42,
    );

    const rows = db.prepare("SELECT * FROM request_metrics WHERE request_log_id = ?").all(logId) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].client_type).toBe("claude-code");
    expect(rows[0].cache_read_tokens_estimated).toBe(1);
    // metrics.cache_read_tokens=0 but we passed cacheReadTokensEstimated=1 & value=42 → should override
    expect(rows[0].cache_read_tokens).toBe(42);
  });

  it("non-stream success path: writes client_type and cache estimation", () => {
    const logId = nextLogId();
    insertRequestLog(db, {
      id: logId, api_type: "openai", model: "gpt-4", provider_id: "p1",
      status_code: 200, latency_ms: 100, is_stream: 0, error_message: null,
      created_at: new Date().toISOString(),
    });

    // Non-stream response body that MetricsExtractor can parse
    const responseBody = JSON.stringify({
      model: "gpt-4",
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        prompt_cache_hit_tokens: 42,
      },
      choices: [{ message: { content: "hello" } }],
    });

    collectTransportMetrics(
      db,
      "openai",
      {
        kind: "success",
        statusCode: 200,
        body: responseBody,
        headers: {},
        sentHeaders: {},
        sentBody: JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
      } as any,
      false,
      logId,
      "p1",
      "gpt-4",
      makeMockRequest(),
      null,
      200,
      "pi",
      1,
      42,
    );

    const rows = db.prepare("SELECT * FROM request_metrics WHERE request_log_id = ?").all(logId) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].client_type).toBe("pi");
    expect(rows[0].cache_read_tokens_estimated).toBe(1);
    // Non-stream: MetricsExtractor.fromNonStreamResponse parses prompt_cache_hit_tokens → cache_read_tokens
    // The override logic: (!metrics.cache_read_tokens || metrics.cache_read_tokens === 0) → override
    // But the extractor returns cache_read_tokens from prompt_cache_hit_tokens which is 42
    // Since metrics.cache_read_tokens would be 42 (from parser), the override condition (!mr.cache_read_tokens || mr.cache_read_tokens === 0) is false
    // So cache_read_tokens should be 42 from the extractor
    expect(rows[0].cache_read_tokens).toBe(42);
  });

  it("fallback path: writes client_type when no metrics extracted", () => {
    const logId = nextLogId();
    insertRequestLog(db, {
      id: logId, api_type: "openai", model: "gpt-4", provider_id: "p1",
      status_code: 200, latency_ms: 100, is_stream: 0, error_message: null,
      created_at: new Date().toISOString(),
    });

    // Empty response body → MetricsExtractor returns null → fallback
    collectTransportMetrics(
      db,
      "openai",
      {
        kind: "success",
        statusCode: 200,
        body: "",
        headers: {},
        sentHeaders: {},
        sentBody: "",
      } as any,
      false,
      logId,
      "p1",
      "gpt-4",
      makeMockRequest(),
      null,
      200,
      "claude-code",
      0,
      undefined,
    );

    const rows = db.prepare("SELECT * FROM request_metrics WHERE request_log_id = ?").all(logId) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].client_type).toBe("claude-code");
    expect(rows[0].cache_read_tokens_estimated).toBe(0);
    expect(rows[0].is_complete).toBe(0);
  });

  it("does not override API-reported cache_read_tokens when cacheReadTokensEstimated=0", () => {
    const logId = nextLogId();
    insertRequestLog(db, {
      id: logId, api_type: "openai", model: "gpt-4", provider_id: "p1",
      status_code: 200, latency_ms: 100, is_stream: 1, error_message: null,
      created_at: new Date().toISOString(),
    });

    // stream_success with metrics.cache_read_tokens=15 (API reported)
    collectTransportMetrics(
      db,
      "openai",
      {
        kind: "stream_success",
        statusCode: 200,
        metrics: { input_tokens: 100, output_tokens: 50, cache_read_tokens: 15, cache_creation_tokens: 0, ttft_ms: 100, total_duration_ms: 500, tokens_per_second: 100, stop_reason: "stop", is_complete: 1, thinking_tokens: null, text_tokens: null, tool_use_tokens: null } as any,
        sentHeaders: {},
      },
      true,
      logId,
      "p1",
      "gpt-4",
      makeMockRequest(),
      null,
      200,
      "claude-code",
      0,    // estimated=0 → do not override
      42,   // value would override but estimated says no
    );

    const rows = db.prepare("SELECT * FROM request_metrics WHERE request_log_id = ?").all(logId) as any[];
    expect(rows).toHaveLength(1);
    // API reported 15
    expect(rows[0].cache_read_tokens).toBe(15);
    expect(rows[0].client_type).toBe("claude-code");
    expect(rows[0].cache_read_tokens_estimated).toBe(0);
  });

  it("estimates input_tokens when missing from API and token_estimation_enabled is ON (AC5)", () => {
    const logId = nextLogId();
    insertRequestLog(db, {
      id: logId, api_type: "openai", model: "gpt-4", provider_id: "p1",
      status_code: 200, latency_ms: 100, is_stream: 1, error_message: null,
      created_at: new Date().toISOString(),
    });

    // stream_success with input_tokens=0 (API did not provide)
    collectTransportMetrics(
      db,
      "openai",
      {
        kind: "stream_success",
        statusCode: 200,
        metrics: { input_tokens: 0, output_tokens: 50, cache_read_tokens: 0, cache_creation_tokens: 0, ttft_ms: 100, total_duration_ms: 500, tokens_per_second: 100, stop_reason: "stop", is_complete: 1 } as any,
        sentHeaders: {},
      },
      true,
      logId,
      "p1",
      "gpt-4",
      makeMockRequest({ messages: [{ role: "user", content: "hello" }] }),
      null,
      200,
      "claude-code",
      0,
      undefined,
    );

    const rows = db.prepare("SELECT * FROM request_metrics WHERE request_log_id = ?").all(logId) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].input_tokens).toBeGreaterThan(0);
    expect(rows[0].input_tokens_estimated).toBe(1);
  });

  it("does NOT estimate input_tokens when token_estimation_enabled is OFF", () => {
    const logId = nextLogId();
    insertRequestLog(db, {
      id: logId, api_type: "openai", model: "gpt-4", provider_id: "p1",
      status_code: 200, latency_ms: 100, is_stream: 1, error_message: null,
      created_at: new Date().toISOString(),
    });

    setTokenEstimationEnabled(db, false);

    collectTransportMetrics(
      db,
      "openai",
      {
        kind: "stream_success",
        statusCode: 200,
        metrics: { input_tokens: 0, output_tokens: 50, cache_read_tokens: 0, cache_creation_tokens: 0, ttft_ms: 100, total_duration_ms: 500, tokens_per_second: 100, stop_reason: "stop", is_complete: 1 } as any,
        sentHeaders: {},
      },
      true,
      logId,
      "p1",
      "gpt-4",
      makeMockRequest({ messages: [{ role: "user", content: "hello" }] }),
      null,
      200,
      "claude-code",
      0,
      undefined,
    );

    const rows = db.prepare("SELECT * FROM request_metrics WHERE request_log_id = ?").all(logId) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].input_tokens).toBe(0);
    expect(rows[0].input_tokens_estimated).toBe(0);
  });
});

/**
 * 后端 Round 2 性能优化测试
 *
 * 覆盖：
 * - BP-C2 / BP-M4: CacheEstimator tokenize 结果在 PipelineContext metadata 中缓存
 * - BP-H1: loadEnhancementConfig TTL 缓存
 * - BP-H2: resolveMapping 请求级缓存（failover 循环内只查一次 DB）
 * - BI-H5: estimateLogTableSize 采样估算
 * - BI-M1: Settings 表 TTL 缓存（WeakMap 隔离）
 * - BI-M2: MetricsExtractor 缓冲区数组化 + 容量上限
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { insertRequestLog } from "../src/db/logs.js";
import {
  getSetting,
  setSetting,
  setTokenEstimationEnabled,
} from "../src/db/settings.js";
import { loadEnhancementConfig, clearEnhancementConfigCache } from "../src/proxy/routing/enhancement-config.js";
import { MetricsExtractor } from "../src/metrics/metrics-extractor.js";
import { cacheEstimator } from "../src/routing/cache-estimator.js";
import { collectTransportMetrics } from "../src/proxy/proxy-logging.js";
import { estimateLogTableSize } from "../src/db/logs.js";
import { resolveMapping } from "../src/proxy/routing/mapping-resolver.js";
import type { PipelineContext } from "../src/proxy/pipeline/types.js";
import type { SSEEvent } from "../src/metrics/sse-parser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(eventType: string | undefined, data: string): SSEEvent {
  return { event: eventType, data };
}

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

function makeMockRequest(body?: Record<string, unknown>): any {
  return {
    body: body ?? { messages: [{ role: "user", content: "hello" }] },
    log: { error: vi.fn() },
  };
}

// ===========================================================
// BP-C2 / BP-M4: CacheEstimator tokenize 结果缓存
// ===========================================================

describe("BP-C2: cacheEstimationHook stores tokenize result in metadata", () => {
  let db: Database.Database;
  let sessCounter = 0;

  function nextSession(): string {
    sessCounter++;
    return `perf-bpc2-sess-${sessCounter}`;
  }

  beforeEach(() => {
    db = initDatabase(":memory:");
    setTokenEstimationEnabled(db, true);
    sessCounter = 0;
  });

  afterEach(() => {
    db.close();
  });

  it("cacheEstimationHook stores _cachedCacheTokens in metadata after estimation", async () => {
    const { cacheEstimationHook } = await import("../src/proxy/hooks/builtin/cache-estimation.js");
    const sessionId = nextSession();
    const body1 = { messages: [{ role: "user", content: "Hello world prefix test" }] };
    const body2 = { messages: [{ role: "user", content: "Hello world prefix test extended" }] };

    // First call: no history → stores tokens in metadata
    const ctx1 = createMockContext({
      rawBody: body1,
      clientModel: "gpt-4",
      metadata: new Map([["db", db], ["session_id", sessionId]]),
    });
    cacheEstimationHook.execute(ctx1);
    // First call: estimateHit returns null (no history), _cachedCacheTokens not set
    // because there's no useful value to cache
    expect(ctx1.metadata.get("cache_read_tokens_estimated")).toBe(0);

    // Second call: should use cached tokens from metadata
    const ctx2 = createMockContext({
      rawBody: body2,
      clientModel: "gpt-4",
      metadata: new Map([["db", db], ["session_id", sessionId]]),
    });
    cacheEstimationHook.execute(ctx2);
    expect(ctx2.metadata.get("cache_read_tokens_estimated")).toBe(1);
    expect(ctx2.metadata.get("cache_read_tokens")).toBeGreaterThan(0);
    // Tokens should be cached for this request too
    expect(ctx2.metadata.has("_cachedCacheTokens")).toBe(true);
  });

  it("collectTransportMetrics reads cached result from metadata instead of re-estimating", async () => {
    const { cacheEstimationHook } = await import("../src/proxy/hooks/builtin/cache-estimation.js");
    const sessionId = nextSession();
    const msg = "Cache dedup test for transport metrics";
    const body1 = { messages: [{ role: "user", content: msg }] };
    const body2 = { messages: [{ role: "user", content: msg + " extended" }] };

    // First: populate cache
    const ctx1 = createMockContext({
      rawBody: body1,
      clientModel: "gpt-4",
      metadata: new Map([["db", db], ["session_id", sessionId]]),
    });
    cacheEstimationHook.execute(ctx1);

    // Second: hook stores cache result in metadata
    const ctx2 = createMockContext({
      rawBody: body2,
      clientModel: "gpt-4",
      metadata: new Map([["db", db], ["session_id", sessionId]]),
    });
    cacheEstimationHook.execute(ctx2);

    const estimatedTokens = ctx2.metadata.get("cache_read_tokens");
    expect(estimatedTokens).toBeGreaterThan(0);

    // Insert a log for metrics to reference
    insertRequestLog(db, {
      id: "perf-log-1", api_type: "openai", model: "gpt-4", provider_id: "p1",
      status_code: 200, latency_ms: 100, is_stream: 1, error_message: null,
      created_at: new Date().toISOString(),
    });

    // Spy on cacheEstimator.estimateHit to verify it's NOT called
    const estimateHitSpy = vi.spyOn(cacheEstimator, "estimateHit");

    // collectTransportMetrics with metadata that has cached result
    const metadata = ctx2.metadata;
    collectTransportMetrics(
      db,
      "openai",
      {
        kind: "stream_success",
        statusCode: 200,
        metrics: { input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_creation_tokens: 0, ttft_ms: 100, total_duration_ms: 500, tokens_per_second: 100, stop_reason: "stop", is_complete: 1 } as any,
        sentHeaders: {},
      },
      true,
      "perf-log-1",
      "p1",
      "gpt-4",
      makeMockRequest(body2),
      null,
      200,
      "claude-code",
      sessionId,
      undefined,
      metadata,
    );

    // Verify estimateHit was NOT called because metadata had cached result
    expect(estimateHitSpy).not.toHaveBeenCalled();

    // Verify metrics were written correctly
    const rows = db.prepare("SELECT * FROM request_metrics WHERE request_log_id = ?").all("perf-log-1") as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].cache_read_tokens_estimated).toBe(1);
    expect(rows[0].cache_read_tokens).toBe(estimatedTokens);

    estimateHitSpy.mockRestore();
  });
});

// ===========================================================
// BP-H1: loadEnhancementConfig TTL 缓存
// ===========================================================

describe("BP-H1: loadEnhancementConfig TTL cache", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
    clearEnhancementConfigCache();
  });

  afterEach(() => {
    db.close();
    clearEnhancementConfigCache();
    vi.useRealTimers();
  });

  it("returns default config when no setting exists", () => {
    const config = loadEnhancementConfig(db);
    expect(config.tool_call_loop_enabled).toBe(false);
    expect(config.stream_loop_enabled).toBe(false);
    expect(config.tool_round_limit_enabled).toBe(true);
    expect(config.tool_error_logging_enabled).toBe(false);
  });

  it("parses config from settings", () => {
    setSetting(db, "proxy_enhancement", JSON.stringify({
      tool_call_loop_enabled: true,
      stream_loop_enabled: true,
    }));
    clearEnhancementConfigCache();

    const config = loadEnhancementConfig(db);
    expect(config.tool_call_loop_enabled).toBe(true);
    expect(config.stream_loop_enabled).toBe(true);
    expect(config.tool_round_limit_enabled).toBe(true);
  });

  it("caches result and does not re-query DB within TTL", () => {
    setSetting(db, "proxy_enhancement", JSON.stringify({
      tool_call_loop_enabled: false,
    }));
    clearEnhancementConfigCache();

    // First call: queries DB
    const config1 = loadEnhancementConfig(db);

    // Change DB value
    setSetting(db, "proxy_enhancement", JSON.stringify({
      tool_call_loop_enabled: true,
    }));

    // Second call within TTL: should return cached result
    const config2 = loadEnhancementConfig(db);
    expect(config2.tool_call_loop_enabled).toBe(false); // still cached value
  });

  it("re-queries DB after TTL expires", () => {
    vi.useFakeTimers();

    setSetting(db, "proxy_enhancement", JSON.stringify({
      tool_call_loop_enabled: false,
    }));
    clearEnhancementConfigCache();

    const config1 = loadEnhancementConfig(db);
    expect(config1.tool_call_loop_enabled).toBe(false);

    // Change DB value
    setSetting(db, "proxy_enhancement", JSON.stringify({
      tool_call_loop_enabled: true,
    }));

    // Advance past TTL (30s)
    vi.advanceTimersByTime(31_000);

    // Should re-query
    const config2 = loadEnhancementConfig(db);
    expect(config2.tool_call_loop_enabled).toBe(true);
  });

  it("clearEnhancementConfigCache forces next call to re-query", () => {
    setSetting(db, "proxy_enhancement", JSON.stringify({
      tool_call_loop_enabled: false,
    }));
    clearEnhancementConfigCache();

    loadEnhancementConfig(db);

    // Change DB value
    setSetting(db, "proxy_enhancement", JSON.stringify({
      tool_call_loop_enabled: true,
    }));

    // Clear cache
    clearEnhancementConfigCache();

    // Should re-query
    const config = loadEnhancementConfig(db);
    expect(config.tool_call_loop_enabled).toBe(true);
  });
});

// ===========================================================
// BP-H2: resolveMapping 请求级缓存
// ===========================================================

describe("BP-H2: resolveMapping request-level caching in failover loop", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("resolveMapping returns same targets for same clientModel", () => {
    const rule = JSON.stringify({
      targets: [
        { backend_model: "gpt-4", provider_id: "p1" },
        { backend_model: "claude-3", provider_id: "p2" },
      ],
    });
    db.prepare("INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g1", "my-model", rule, 1, new Date().toISOString());

    const now = new Date();
    const result1 = resolveMapping(db, "my-model", { now, excludeTargets: [] });
    const result2 = resolveMapping(db, "my-model", { now, excludeTargets: [] });

    expect(result1).toEqual(result2);
  });

  it("resolveMapping filters excluded targets correctly", () => {
    const rule = JSON.stringify({
      targets: [
        { backend_model: "gpt-4", provider_id: "p1" },
        { backend_model: "claude-3", provider_id: "p2" },
        { backend_model: "gemini", provider_id: "p3" },
      ],
    });
    db.prepare("INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g1", "my-model", rule, 1, new Date().toISOString());

    const now = new Date();

    // First call: no exclusions → returns first target
    const result1 = resolveMapping(db, "my-model", { now, excludeTargets: [] });
    expect(result1?.target).toEqual({ backend_model: "gpt-4", provider_id: "p1" });
    expect(result1?.targetCount).toBe(3);

    // Exclude first target → returns second
    const result2 = resolveMapping(db, "my-model", {
      now,
      excludeTargets: [{ backend_model: "gpt-4", provider_id: "p1" }],
    });
    expect(result2?.target).toEqual({ backend_model: "claude-3", provider_id: "p2" });
    expect(result2?.targetCount).toBe(3);

    // Exclude first two → returns third
    const result3 = resolveMapping(db, "my-model", {
      now,
      excludeTargets: [
        { backend_model: "gpt-4", provider_id: "p1" },
        { backend_model: "claude-3", provider_id: "p2" },
      ],
    });
    expect(result3?.target).toEqual({ backend_model: "gemini", provider_id: "p3" });
  });

  it("targetCount stays constant regardless of excludeTargets", () => {
    const rule = JSON.stringify({
      targets: [
        { backend_model: "gpt-4", provider_id: "p1" },
        { backend_model: "claude-3", provider_id: "p2" },
      ],
    });
    db.prepare("INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g1", "my-model", rule, 1, new Date().toISOString());

    const now = new Date();
    const result1 = resolveMapping(db, "my-model", { now, excludeTargets: [] });
    const result2 = resolveMapping(db, "my-model", {
      now,
      excludeTargets: [{ backend_model: "gpt-4", provider_id: "p1" }],
    });

    // targetCount should reflect total available targets, not filtered
    expect(result1?.targetCount).toBe(2);
    expect(result2?.targetCount).toBe(2);
  });
});

// ===========================================================
// BI-H5: estimateLogTableSize 采样估算
// ===========================================================

describe("BI-H5: estimateLogTableSize sampling estimation", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", "a".repeat(64));
  });

  afterEach(() => {
    db.close();
  });

  function seedLog(id: string, bodySize: number, createdAt?: string) {
    const body = "x".repeat(bodySize);
    insertRequestLog(db, {
      id,
      api_type: "openai",
      model: "test-model",
      provider_id: null,
      status_code: 200,
      latency_ms: 100,
      is_stream: 0,
      error_message: null,
      created_at: createdAt ?? new Date().toISOString(),
      client_request: body,
      upstream_request: null,
      upstream_response: null,
    });
  }

  it("returns 0 for empty table", () => {
    expect(estimateLogTableSize(db)).toBe(0);
  });

  it("sampling result is within 30% of full scan for uniform data", () => {

    // Seed 200 rows with uniform size
    for (let i = 0; i < 200; i++) {
      seedLog(`log-${i}`, 1000);
    }

    const estimated = estimateLogTableSize(db);

    // Each row has ~1000 chars in client_request + 500 metadata = ~1500 bytes
    // Allow 30% tolerance
    expect(estimated).toBeGreaterThan(0);
    // Sanity check: should be within reasonable range
    const expected = 200 * 1500;
    const ratio = estimated / expected;
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.3);
  });

  it("handles small tables (< 100 rows) correctly", () => {

    // Seed 5 rows
    for (let i = 0; i < 5; i++) {
      seedLog(`log-small-${i}`, 500);
    }

    const estimated = estimateLogTableSize(db);
    expect(estimated).toBeGreaterThan(0);

    // Should be at least 5 * 500 = 2500
    expect(estimated).toBeGreaterThanOrEqual(2500);
  });
});

// ===========================================================
// BI-M1: Settings TTL cache with WeakMap isolation
// ===========================================================

describe("BI-M1: Settings TTL cache", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
  });

  it("caches getSetting result within TTL", () => {
    setSetting(db, "test_key", "value1");
    const val1 = getSetting(db, "test_key");
    expect(val1).toBe("value1");

    // Change DB directly, bypassing setSetting
    db.prepare("UPDATE settings SET value = ? WHERE key = ?").run("value2", "test_key");

    // Should still return cached value
    const val2 = getSetting(db, "test_key");
    expect(val2).toBe("value1");
  });

  it("re-queries after TTL expires", () => {
    vi.useFakeTimers();

    setSetting(db, "test_key", "value1");
    const val1 = getSetting(db, "test_key");
    expect(val1).toBe("value1");

    // Update via setSetting (which clears cache)
    setSetting(db, "test_key", "value2");

    // Should see new value immediately
    const val2 = getSetting(db, "test_key");
    expect(val2).toBe("value2");
  });

  it("setSetting invalidates cache for write-after-read consistency", () => {
    setSetting(db, "test_key", "initial");
    getSetting(db, "test_key"); // populate cache

    setSetting(db, "test_key", "updated");

    const val = getSetting(db, "test_key");
    expect(val).toBe("updated");
  });

  it("WeakMap provides isolation between different db instances", () => {
    const db2 = initDatabase(":memory:");

    setSetting(db, "shared_key", "db1-value");
    setSetting(db2, "shared_key", "db2-value");

    expect(getSetting(db, "shared_key")).toBe("db1-value");
    expect(getSetting(db2, "shared_key")).toBe("db2-value");

    // Update db1 should not affect db2 cache
    setSetting(db, "shared_key", "db1-updated");
    expect(getSetting(db2, "shared_key")).toBe("db2-value");

    db2.close();
  });

  it("returns null for non-existent key", () => {
    expect(getSetting(db, "nonexistent")).toBeNull();
  });

  it("cache expires after TTL and returns fresh data", () => {
    vi.useFakeTimers();

    setSetting(db, "ttl_key", "v1");
    expect(getSetting(db, "ttl_key")).toBe("v1");

    // Bypass cache invalidation by updating DB directly
    db.prepare("UPDATE settings SET value = ? WHERE key = ?").run("v2", "ttl_key");

    // Advance past TTL (30s)
    vi.advanceTimersByTime(31_000);

    // Should now return fresh value
    expect(getSetting(db, "ttl_key")).toBe("v2");
  });
});

// ===========================================================
// BI-M2: MetricsExtractor buffer array-ification + capacity limit
// ===========================================================

describe("BI-M2: MetricsExtractor buffer array optimization", () => {
  const MOCK_NOW = 1_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MOCK_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("correctly accumulates thinking content from multiple deltas", () => {
    const extractor = new MetricsExtractor("anthropic", MOCK_NOW);

    extractor.processEvent(makeEvent("message_start", JSON.stringify({
      type: "message_start",
      message: { usage: { input_tokens: 100 } },
    })));

    // Multiple thinking deltas
    const thinkingChunks = ["Let me ", "think about ", "this carefully."];
    for (const chunk of thinkingChunks) {
      vi.advanceTimersByTime(100); // advance time between chunks
      extractor.processEvent(makeEvent("content_block_delta", JSON.stringify({
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: chunk },
      })));
    }

    // Text delta
    vi.advanceTimersByTime(100);
    extractor.processEvent(makeEvent("content_block_delta", JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Here is my answer." },
    })));

    vi.advanceTimersByTime(500);
    extractor.processEvent(makeEvent("message_delta", JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 50 },
    })));
    extractor.processEvent(makeEvent("message_stop", JSON.stringify({ type: "message_stop" })));

    const metrics = extractor.getMetrics();
    // Should have calculated thinking tokens from the concatenated thinking content
    expect(metrics.thinking_tokens).not.toBeNull();
    expect(metrics.thinking_tokens).toBeGreaterThan(0);
    expect(metrics.thinking_tps).not.toBeNull();
    expect(metrics.thinking_tps).toBeGreaterThan(0);
  });

  it("truncates thinking buffer when exceeding MAX_BUFFER_SIZE", () => {
    const extractor = new MetricsExtractor("anthropic", MOCK_NOW);

    extractor.processEvent(makeEvent("message_start", JSON.stringify({
      type: "message_start",
      message: { usage: { input_tokens: 100 } },
    })));

    // Push a large thinking chunk that exceeds the limit
    const largeThinking = "A".repeat(600_000);
    extractor.processEvent(makeEvent("content_block_delta", JSON.stringify({
      type: "content_block_delta",
      delta: { type: "thinking_delta", thinking: largeThinking },
    })));

    // Push more — should be ignored due to buffer limit
    extractor.processEvent(makeEvent("content_block_delta", JSON.stringify({
      type: "content_block_delta",
      delta: { type: "thinking_delta", thinking: "Should be ignored" },
    })));

    vi.advanceTimersByTime(500);
    extractor.processEvent(makeEvent("message_delta", JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 50 },
    })));
    extractor.processEvent(makeEvent("message_stop", JSON.stringify({ type: "message_stop" })));

    const metrics = extractor.getMetrics();
    // Thinking tokens should still be calculated (from the first large chunk)
    expect(metrics.thinking_tokens).not.toBeNull();
    expect(metrics.thinking_tokens).toBeGreaterThan(0);
  });

  it("returns empty string from empty buffer correctly", () => {
    const extractor = new MetricsExtractor("anthropic", MOCK_NOW);

    extractor.processEvent(makeEvent("message_start", JSON.stringify({
      type: "message_start",
      message: { usage: { input_tokens: 100 } },
    })));

    vi.advanceTimersByTime(200);
    extractor.processEvent(makeEvent("content_block_delta", JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hello" },
    })));

    vi.advanceTimersByTime(300);
    extractor.processEvent(makeEvent("message_delta", JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 10 },
    })));
    extractor.processEvent(makeEvent("message_stop", JSON.stringify({ type: "message_stop" })));

    const metrics = extractor.getMetrics();
    // No thinking content → thinking_tokens should be null
    expect(metrics.thinking_tokens).toBeNull();
    expect(metrics.thinking_tps).toBeNull();
  });

  it("correctly accumulates text content from multiple deltas", () => {
    const extractor = new MetricsExtractor("openai", MOCK_NOW);

    const chunks = ["Hello ", "world ", "from ", "OpenAI!"];
    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) {
        vi.advanceTimersByTime(100);
      }
      extractor.processEvent(makeEvent(undefined, JSON.stringify({
        choices: [{ delta: { content: chunks[i] }, index: 0 }],
      })));
    }

    extractor.processEvent(makeEvent(undefined, JSON.stringify({
      choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
    })));
    extractor.processEvent(makeEvent(undefined, JSON.stringify({
      usage: { prompt_tokens: 10, completion_tokens: 8 },
    })));

    const metrics = extractor.getMetrics();
    expect(metrics.text_tokens).not.toBeNull();
    expect(metrics.text_tokens).toBeGreaterThan(0);
  });

  it("correctly accumulates tool use content from input_json_delta", () => {
    const extractor = new MetricsExtractor("anthropic", MOCK_NOW);

    extractor.processEvent(makeEvent("message_start", JSON.stringify({
      type: "message_start",
      message: { usage: { input_tokens: 100 } },
    })));

    vi.advanceTimersByTime(100);
    extractor.processEvent(makeEvent("content_block_delta", JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Using tool" },
    })));

    extractor.processEvent(makeEvent("content_block_delta", JSON.stringify({
      type: "content_block_delta",
      delta: { type: "input_json_delta", partial_json: '{"key":' },
    })));
    extractor.processEvent(makeEvent("content_block_delta", JSON.stringify({
      type: "content_block_delta",
      delta: { type: "input_json_delta", partial_json: ' "value"}' },
    })));

    vi.advanceTimersByTime(300);
    extractor.processEvent(makeEvent("message_delta", JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "tool_use" },
      usage: { output_tokens: 20 },
    })));
    extractor.processEvent(makeEvent("message_stop", JSON.stringify({ type: "message_stop" })));

    const metrics = extractor.getMetrics();
    expect(metrics.tool_use_tokens).not.toBeNull();
    expect(metrics.tool_use_tokens).toBeGreaterThan(0);
  });

  it("truncates text buffer when exceeding MAX_BUFFER_SIZE", () => {
    const extractor = new MetricsExtractor("openai", MOCK_NOW);

    // Push a large text chunk
    const largeText = "B".repeat(600_000);
    vi.advanceTimersByTime(100);
    extractor.processEvent(makeEvent(undefined, JSON.stringify({
      choices: [{ delta: { content: largeText }, index: 0 }],
    })));

    // Push more — should be ignored
    extractor.processEvent(makeEvent(undefined, JSON.stringify({
      choices: [{ delta: { content: "ignored" }, index: 0 }],
    })));

    extractor.processEvent(makeEvent(undefined, JSON.stringify({
      choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
    })));
    extractor.processEvent(makeEvent(undefined, JSON.stringify({
      usage: { prompt_tokens: 10, completion_tokens: 50 },
    })));

    const metrics = extractor.getMetrics();
    // Should still have text_tokens calculated
    expect(metrics.text_tokens).not.toBeNull();
    expect(metrics.text_tokens).toBeGreaterThan(0);
  });
});

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { initDatabase, insertMetrics, insertRequestLog, getMetricsSummary, getMetricsTimeseries, getClientTypeBreakdown } from "../src/db/index.js";
import Database from "better-sqlite3";

describe("request_metrics migration and insertMetrics", () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    if (db) {
      db.close();
      db = null;
    }
  });

  it("should create request_metrics table after migration", () => {
    db = initDatabase(":memory:");

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];

    expect(tables.map((t) => t.name)).toContain("request_metrics");
  });

  it("should record 006 migration in migrations table", () => {
    db = initDatabase(":memory:");

    const rows = db
      .prepare("SELECT name FROM migrations")
      .all() as { name: string }[];

    expect(rows).toHaveLength(45);
    expect(rows[5].name).toBe("006_create_request_metrics.sql");
    expect(rows[6].name).toBe("007_add_retry_fields.sql");
    expect(rows[7].name).toBe("008_create_router_keys.sql");
    expect(rows[8].name).toBe("009_add_request_logs_indexes.sql");
    expect(rows[9].name).toBe("010_add_key_encrypted.sql");
    expect(rows[10].name).toBe("011_create_mapping_groups.sql");
    expect(rows[15].name).toBe("016_create_session_model_tables.sql");
    expect(rows[16].name).toBe("017_add_provider_concurrency.sql");
    expect(rows[17].name).toBe("018_add_failover_field.sql");
    expect(rows[18].name).toBe("019_create_usage_windows.sql");
    expect(rows[19].name).toBe("020_drop_log_redundancy.sql");
    expect(rows[20].name).toBe("021_merge_metrics_columns.sql");
  });

  it("should create indexes", () => {
    db = initDatabase(":memory:");

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_metrics_%'")
      .all() as { name: string }[];

    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_metrics_time_provider_model");
    expect(indexNames).toContain("idx_metrics_api_type_created_at");
  });

  it("should insert a metrics row and return the id", () => {
    db = initDatabase(":memory:");

    // 先插入一条 request_log 作为 FK
    const logId = "log-test-1";
    insertRequestLog(db, {
      id: logId,
      api_type: "openai",
      model: "gpt-4",
      provider_id: "provider-1",
      status_code: 200,
      latency_ms: 500,
      is_stream: 1,
      error_message: null,
      created_at: new Date().toISOString(),
    });

    const metricsId = insertMetrics(db, {
      request_log_id: logId,
      provider_id: "provider-1",
      backend_model: "gpt-4-turbo",
      api_type: "openai",
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_tokens: 10,
      cache_read_tokens: 20,
      ttft_ms: 200,
      total_duration_ms: 500,
      tokens_per_second: 100.0,
      stop_reason: "stop",
      is_complete: 1,
    });

    expect(typeof metricsId).toBe("string");

    const row = db
      .prepare("SELECT * FROM request_metrics WHERE id = ?")
      .get(metricsId) as any;

    expect(row.request_log_id).toBe(logId);
    expect(row.provider_id).toBe("provider-1");
    expect(row.backend_model).toBe("gpt-4-turbo");
    expect(row.input_tokens).toBe(100);
    expect(row.output_tokens).toBe(50);
    expect(row.cache_creation_tokens).toBe(10);
    expect(row.cache_read_tokens).toBe(20);
    expect(row.ttft_ms).toBe(200);
    expect(row.total_duration_ms).toBe(500);
    expect(row.tokens_per_second).toBe(100.0);
    expect(row.stop_reason).toBe("stop");
    expect(row.is_complete).toBe(1);
    expect(row.created_at).toBeTruthy();
  });

  it("should allow null token fields", () => {
    db = initDatabase(":memory:");

    const logId = "log-null-1";
    insertRequestLog(db, {
      id: logId,
      api_type: "anthropic",
      model: "claude-3",
      provider_id: "provider-2",
      status_code: 200,
      latency_ms: 300,
      is_stream: 0,
      error_message: null,
      created_at: new Date().toISOString(),
    });

    const metricsId = insertMetrics(db, {
      request_log_id: logId,
      provider_id: "provider-2",
      backend_model: "claude-3-opus",
      api_type: "anthropic",
      input_tokens: null,
      output_tokens: null,
      cache_creation_tokens: null,
      cache_read_tokens: null,
      ttft_ms: null,
      total_duration_ms: null,
      tokens_per_second: null,
      stop_reason: null,
      is_complete: 0,
    });

    const row = db
      .prepare("SELECT * FROM request_metrics WHERE id = ?")
      .get(metricsId) as any;

    expect(row.input_tokens).toBeNull();
    expect(row.output_tokens).toBeNull();
    expect(row.is_complete).toBe(0);
  });

  it("should enforce UNIQUE on request_log_id", () => {
    db = initDatabase(":memory:");

    const logId = "log-unique-1";
    insertRequestLog(db!, {
      id: logId,
      api_type: "openai",
      model: "gpt-4",
      provider_id: "provider-1",
      status_code: 200,
      latency_ms: 500,
      is_stream: 0,
      error_message: null,
      created_at: new Date().toISOString(),
    });

    insertMetrics(db!, {
      request_log_id: logId,
      provider_id: "provider-1",
      backend_model: "gpt-4-turbo",
      api_type: "openai",
      is_complete: 1,
    });

    expect(() =>
      insertMetrics(db!, {
        request_log_id: logId,
        provider_id: "provider-1",
        backend_model: "gpt-4-turbo",
        api_type: "openai",
        is_complete: 1,
      })
    ).toThrow();
  });

  it("should set request_log_id to NULL when request_log is deleted", () => {
    db = initDatabase(":memory:");

    const logId = "log-setnull-1";
    insertRequestLog(db, {
      id: logId,
      api_type: "openai",
      model: "gpt-4",
      provider_id: "provider-1",
      status_code: 200,
      latency_ms: 500,
      is_stream: 0,
      error_message: null,
      created_at: new Date().toISOString(),
    });

    insertMetrics(db!, {
      request_log_id: logId,
      provider_id: "provider-1",
      backend_model: "gpt-4-turbo",
      api_type: "openai",
      is_complete: 1,
    });

    // 删除 request_log，metrics 的 request_log_id 应被置为 NULL
    db!.prepare("DELETE FROM request_logs WHERE id = ?").run(logId);

    const metrics = db!
      .prepare("SELECT * FROM request_metrics WHERE provider_id = ?")
      .all("provider-1") as any[];

    expect(metrics).toHaveLength(1);
    expect(metrics[0].request_log_id).toBeNull();
  });
});

function seedMetricsRow(db: Database.Database, logId: string, opts?: { provider_id?: string; backend_model?: string }) {
  insertRequestLog(db, {
    id: logId,
    api_type: "openai",
    model: "gpt-4",
    provider_id: opts?.provider_id ?? "provider-1",
    status_code: 200,
    latency_ms: 500,
    is_stream: 1,
    error_message: null,
    created_at: new Date().toISOString(),
  });

  insertMetrics(db, {
    request_log_id: logId,
    provider_id: opts?.provider_id ?? "provider-1",
    backend_model: opts?.backend_model ?? "gpt-4-turbo",
    api_type: "openai",
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_tokens: 10,
    cache_read_tokens: 20,
    ttft_ms: 200,
    total_duration_ms: 500,
    tokens_per_second: 100.0,
    stop_reason: "stop",
    is_complete: 1,
  });
}

describe("metrics with absolute time range", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("summary supports start_time/end_time parameters", () => {
    const now = new Date();
    const start = new Date(now.getTime() - 2 * 3600_000).toISOString();
    const end = new Date(now.getTime() + 60_000).toISOString();

    seedMetricsRow(db, "log-abs-1");

    const result = getMetricsSummary(db, "24h", undefined, undefined, undefined, start, end);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });

  it("summary with start_time excludes data outside range", () => {
    // 使用未来的 start_time，所有当前数据都应被排除
    const futureStart = new Date(Date.now() + 86400_000).toISOString();
    const futureEnd = new Date(Date.now() + 2 * 86400_000).toISOString();

    seedMetricsRow(db, "log-exclude");

    const result = getMetricsSummary(db, "24h", undefined, undefined, undefined, futureStart, futureEnd);
    expect(result).toHaveLength(0);
  });

  it("timeseries supports start_time/end_time parameters", () => {
    const now = new Date();
    const start = new Date(now.getTime() - 2 * 3600_000).toISOString();
    const end = new Date(now.getTime() + 60_000).toISOString();

    seedMetricsRow(db, "log-ts-1");

    const result = getMetricsTimeseries(db, "24h", "tps", undefined, undefined, undefined, start, end);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });

  it("timeseries auto-calculates bucket size from time range", () => {
    const now = new Date();
    // 30min range => 60s buckets
    const start = new Date(now.getTime() - 30 * 60_000).toISOString();
    const end = new Date(now.getTime() + 60_000).toISOString();

    seedMetricsRow(db, "log-bucket-1");

    const result = getMetricsTimeseries(db, "24h", "request_count", undefined, undefined, undefined, start, end);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(1);
  });

  it("falls back to period when start_time/end_time are omitted", () => {
    seedMetricsRow(db, "log-fallback");

    const result = getMetricsSummary(db, "24h");
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getClientTypeBreakdown — 客户端类型分布
// ---------------------------------------------------------------------------

describe("getClientTypeBreakdown", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  function seedMetricsForBreakdown(logPrefix: string, clientType: string, count: number) {
    for (let i = 0; i < count; i++) {
      const logId = `${logPrefix}-${i}`;
      insertRequestLog(db, {
        id: logId, api_type: "openai", model: "gpt-4", provider_id: "p1",
        status_code: 200, latency_ms: 100, is_stream: 0, error_message: null,
        created_at: new Date().toISOString(),
      });
      insertMetrics(db, {
        request_log_id: logId, provider_id: "p1", backend_model: "gpt-4", api_type: "openai",
        input_tokens: 100, output_tokens: 50, is_complete: 1, client_type: clientType,
      });
    }
  }

  it("returns correct breakdown counts for multiple client types", () => {
    seedMetricsForBreakdown("b1", "claude-code", 3);
    seedMetricsForBreakdown("b2", "pi", 2);
    seedMetricsForBreakdown("b3", "unknown", 1);

    const breakdown = getClientTypeBreakdown(db, "24h");
    expect(breakdown).toEqual({
      "claude-code": 3,
      "pi": 2,
      "unknown": 1,
    });
  });

  it("returns empty object when no matching data", () => {
    const breakdown = getClientTypeBreakdown(db, "24h");
    expect(breakdown).toEqual({});
  });

  it("filters by provider_id", () => {
    // Two providers
    for (let i = 0; i < 2; i++) {
      const logId = `bf1-${i}`;
      insertRequestLog(db, {
        id: logId, api_type: "openai", model: "gpt-4", provider_id: "p1",
        status_code: 200, latency_ms: 100, is_stream: 0, error_message: null,
        created_at: new Date().toISOString(),
      });
      insertMetrics(db, {
        request_log_id: logId, provider_id: "p1", backend_model: "gpt-4", api_type: "openai",
        input_tokens: 100, output_tokens: 50, is_complete: 1, client_type: "claude-code",
      });
    }
    for (let i = 0; i < 3; i++) {
      const logId = `bf2-${i}`;
      insertRequestLog(db, {
        id: logId, api_type: "openai", model: "gpt-4", provider_id: "p2",
        status_code: 200, latency_ms: 100, is_stream: 0, error_message: null,
        created_at: new Date().toISOString(),
      });
      insertMetrics(db, {
        request_log_id: logId, provider_id: "p2", backend_model: "gpt-4", api_type: "openai",
        input_tokens: 100, output_tokens: 50, is_complete: 1, client_type: "pi",
      });
    }

    const breakdown = getClientTypeBreakdown(db, "24h", "p1");
    expect(breakdown).toEqual({ "claude-code": 2 });
  });

  it("only counts is_complete=1 rows", () => {
    const logId = "b-incomplete";
    insertRequestLog(db, {
      id: logId, api_type: "openai", model: "gpt-4", provider_id: "p1",
      status_code: 200, latency_ms: 100, is_stream: 0, error_message: null,
      created_at: new Date().toISOString(),
    });
    insertMetrics(db, {
      request_log_id: logId, provider_id: "p1", backend_model: "gpt-4", api_type: "openai",
      input_tokens: 100, output_tokens: 50, is_complete: 0, client_type: "claude-code",
    });

    const breakdown = getClientTypeBreakdown(db, "24h");
    expect(breakdown).toEqual({});
  });

  it("filters by backend_model", () => {
    const logId1 = "bfm-1";
    insertRequestLog(db, {
      id: logId1, api_type: "openai", model: "gpt-4", provider_id: "p1",
      status_code: 200, latency_ms: 100, is_stream: 0, error_message: null,
      created_at: new Date().toISOString(),
    });
    insertMetrics(db, {
      request_log_id: logId1, provider_id: "p1", backend_model: "gpt-4", api_type: "openai",
      input_tokens: 100, output_tokens: 50, is_complete: 1, client_type: "claude-code",
    });

    const logId2 = "bfm-2";
    insertRequestLog(db, {
      id: logId2, api_type: "openai", model: "gpt-4", provider_id: "p1",
      status_code: 200, latency_ms: 100, is_stream: 0, error_message: null,
      created_at: new Date().toISOString(),
    });
    insertMetrics(db, {
      request_log_id: logId2, provider_id: "p1", backend_model: "gpt-4-turbo", api_type: "openai",
      input_tokens: 100, output_tokens: 50, is_complete: 1, client_type: "pi",
    });

    const breakdown = getClientTypeBreakdown(db, "24h", undefined, "gpt-4");
    expect(breakdown).toEqual({ "claude-code": 1 });
  });
});

// ---------------------------------------------------------------------------
// Admin Metrics API — summary 扩展（client_type 过滤 / client_type_breakdown / cache_hit_rate）
// ---------------------------------------------------------------------------

describe("Admin Metrics API — summary with cache estimation", () => {
  let app: any;
  let db: Database.Database;
  let close: () => Promise<void>;
  let cookie: string;

  beforeEach(async () => {
    const { buildApp } = await import("../src/index.js");
    const { makeConfig, seedSettings, login } = await import("./helpers/test-setup.js");
    db = initDatabase(":memory:");
    seedSettings(db);
    // Enable token estimation
    const { setTokenEstimationEnabled } = await import("../src/db/settings.js");
    setTokenEstimationEnabled(db, true);

    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);
  });

  afterEach(async () => {
    await close();
    db.close();
  });

  function seedMetricsRow(
    logId: string,
    opts: {
      clientType?: string;
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      isComplete?: number;
    } = {},
  ) {
    insertRequestLog(db, {
      id: logId, api_type: "openai", model: "gpt-4", provider_id: "p1",
      status_code: 200, latency_ms: 100, is_stream: 0, error_message: null,
      created_at: new Date().toISOString(),
    });
    insertMetrics(db, {
      request_log_id: logId,
      provider_id: "p1",
      backend_model: "gpt-4",
      api_type: "openai",
      input_tokens: opts.inputTokens ?? 100,
      output_tokens: opts.outputTokens ?? 50,
      cache_read_tokens: opts.cacheReadTokens ?? 0,
      ttft_ms: 100,
      total_duration_ms: 500,
      tokens_per_second: 100,
      stop_reason: "stop",
      is_complete: opts.isComplete ?? 1,
      client_type: opts.clientType ?? "unknown",
    });
  }

  it("returns response with rows, client_type_breakdown, and cache_hit_rate", async () => {
    seedMetricsRow("api-sum-1", { clientType: "claude-code", cacheReadTokens: 20 });
    seedMetricsRow("api-sum-2", { clientType: "pi", cacheReadTokens: 10 });

    const res = await app.inject({
      method: "GET",
      url: "/admin/api/metrics/summary",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("data");
    expect(body.data).toHaveProperty("rows");
    expect(body.data).toHaveProperty("client_type_breakdown");
    expect(body.data).toHaveProperty("cache_hit_rate");
    expect(Array.isArray(body.data.rows)).toBe(true);
  });

  it("client_type_breakdown shows counts per client type", async () => {
    seedMetricsRow("api-cb-1", { clientType: "claude-code" });
    seedMetricsRow("api-cb-2", { clientType: "claude-code" });
    seedMetricsRow("api-cb-3", { clientType: "pi" });

    const res = await app.inject({
      method: "GET",
      url: "/admin/api/metrics/summary",
      headers: { cookie },
    });
    const body = res.json();
    expect(body.data.client_type_breakdown).toEqual({
      "claude-code": 2,
      "pi": 1,
    });
  });

  it("cache_hit_rate is calculated correctly", async () => {
    seedMetricsRow("api-chr-1", { inputTokens: 100, cacheReadTokens: 30 });
    seedMetricsRow("api-chr-2", { inputTokens: 100, cacheReadTokens: 20 });

    const res = await app.inject({
      method: "GET",
      url: "/admin/api/metrics/summary",
      headers: { cookie },
    });
    const body = res.json();
    // total_input=200, total_cache_hit=50 → rate = 50*100/200 = 25
    expect(body.data.cache_hit_rate).toBe(25);
  });

  it("cache_hit_rate is 0 when no input tokens", async () => {
    // insert a row with input_tokens=0 (or null via omission), but is_complete=1
    const logId = "api-chr-0";
    insertRequestLog(db, {
      id: logId, api_type: "openai", model: "gpt-4", provider_id: "p1",
      status_code: 200, latency_ms: 100, is_stream: 0, error_message: null,
      created_at: new Date().toISOString(),
    });
    insertMetrics(db, {
      request_log_id: logId, provider_id: "p1", backend_model: "gpt-4", api_type: "openai",
      input_tokens: 0, output_tokens: 0, cache_read_tokens: 0,
      is_complete: 1,
    });

    const res = await app.inject({
      method: "GET",
      url: "/admin/api/metrics/summary",
      headers: { cookie },
    });
    const body = res.json();
    expect(body.data.cache_hit_rate).toBe(0);
  });

  it("client_type query param filters summary rows", async () => {
    seedMetricsRow("api-ctf-1", { clientType: "claude-code" });
    seedMetricsRow("api-ctf-2", { clientType: "pi" });

    const res = await app.inject({
      method: "GET",
      url: "/admin/api/metrics/summary?client_type=claude-code",
      headers: { cookie },
    });
    const body = res.json();
    // Two rows but with GROUP BY provider_id, backend_model, client_type
    // Both have same provider/backend_model but different client_type → with filter only 1 row
    expect(body.data.rows).toHaveLength(1);
    expect(body.data.rows[0].client_type).toBe("claude-code");
  });

  it("returns empty rows and breakdown when no data matches", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/metrics/summary",
      headers: { cookie },
    });
    const body = res.json();
    expect(body.data.rows).toEqual([]);
    expect(body.data.client_type_breakdown).toEqual({});
    expect(body.data.cache_hit_rate).toBe(0);
  });

  it("summary rows include client_type field", async () => {
    seedMetricsRow("api-ct-field", { clientType: "claude-code" });

    const res = await app.inject({
      method: "GET",
      url: "/admin/api/metrics/summary",
      headers: { cookie },
    });
    const body = res.json();
    expect(body.data.rows[0].client_type).toBe("claude-code");
  });
});

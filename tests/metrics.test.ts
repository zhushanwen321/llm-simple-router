import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { initDatabase, insertMetrics, insertRequestLog, getMetricsSummary, getMetricsTimeseries } from "../src/db/index.js";
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

    expect(rows).toHaveLength(35);
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

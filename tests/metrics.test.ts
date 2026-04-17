import { describe, it, expect, afterEach } from "vitest";
import { initDatabase, insertMetrics, insertRequestLog } from "../src/db/index.js";
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

    expect(rows).toHaveLength(13);
    expect(rows[5].name).toBe("006_create_request_metrics.sql");
    expect(rows[6].name).toBe("007_add_retry_fields.sql");
    expect(rows[7].name).toBe("008_create_router_keys.sql");
    expect(rows[8].name).toBe("009_add_request_logs_indexes.sql");
    expect(rows[9].name).toBe("010_add_key_encrypted.sql");
    expect(rows[10].name).toBe("011_create_mapping_groups.sql");
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

  it("should enforce FK constraint - cascade delete on request_logs", () => {
    db = initDatabase(":memory:");

    const logId = "log-cascade-1";
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

    // 删除 request_log，metrics 应该被级联删除
    db!.prepare("DELETE FROM request_logs WHERE id = ?").run(logId);

    const metrics = db!
      .prepare("SELECT * FROM request_metrics WHERE request_log_id = ?")
      .all(logId) as any[];

    expect(metrics).toHaveLength(0);
  });
});

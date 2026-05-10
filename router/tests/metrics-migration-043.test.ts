import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { initDatabase, insertMetrics, insertRequestLog, getMetricsSummary } from "../src/db/index.js";
import Database from "better-sqlite3";

describe("043_add_client_type_and_cache_estimation", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("should add client_type column defaulting to 'unknown'", () => {
    const logId = "log-ct-1";
    insertRequestLog(db, {
      id: logId, api_type: "openai", model: "gpt-4", provider_id: "p1",
      status_code: 200, latency_ms: 100, is_stream: 0, error_message: null,
      created_at: new Date().toISOString(),
    });
    const mid = insertMetrics(db, {
      request_log_id: logId, provider_id: "p1", backend_model: "gpt-4", api_type: "openai",
    });
    const row = db.prepare("SELECT client_type FROM request_metrics WHERE id = ?").get(mid) as any;
    expect(row.client_type).toBe("unknown");
  });

  it("should accept custom client_type on insert", () => {
    const logId = "log-ct-2";
    insertRequestLog(db, {
      id: logId, api_type: "openai", model: "gpt-4", provider_id: "p1",
      status_code: 200, latency_ms: 100, is_stream: 0, error_message: null,
      created_at: new Date().toISOString(),
    });
    const mid = insertMetrics(db, {
      request_log_id: logId, provider_id: "p1", backend_model: "gpt-4", api_type: "openai",
      client_type: "claude-code",
    });
    const row = db.prepare("SELECT client_type FROM request_metrics WHERE id = ?").get(mid) as any;
    expect(row.client_type).toBe("claude-code");
  });

  it("should add cache_read_tokens_estimated column defaulting to 0", () => {
    const logId = "log-cre-1";
    insertRequestLog(db, {
      id: logId, api_type: "openai", model: "gpt-4", provider_id: "p1",
      status_code: 200, latency_ms: 100, is_stream: 0, error_message: null,
      created_at: new Date().toISOString(),
    });
    const mid = insertMetrics(db, {
      request_log_id: logId, provider_id: "p1", backend_model: "gpt-4", api_type: "openai",
    });
    const row = db.prepare("SELECT cache_read_tokens_estimated FROM request_metrics WHERE id = ?").get(mid) as any;
    expect(row.cache_read_tokens_estimated).toBe(0);
  });

  it("should accept custom cache_read_tokens_estimated on insert", () => {
    const logId = "log-cre-2";
    insertRequestLog(db, {
      id: logId, api_type: "openai", model: "gpt-4", provider_id: "p1",
      status_code: 200, latency_ms: 100, is_stream: 0, error_message: null,
      created_at: new Date().toISOString(),
    });
    const mid = insertMetrics(db, {
      request_log_id: logId, provider_id: "p1", backend_model: "gpt-4", api_type: "openai",
      cache_read_tokens_estimated: 1,
    });
    const row = db.prepare("SELECT cache_read_tokens_estimated FROM request_metrics WHERE id = ?").get(mid) as any;
    expect(row.cache_read_tokens_estimated).toBe(1);
  });

  it("getMetricsSummary filters by client_type", () => {
    const logId1 = "log-ct-filter-1";
    const logId2 = "log-ct-filter-2";
    insertRequestLog(db, {
      id: logId1, api_type: "openai", model: "gpt-4", provider_id: "p1",
      status_code: 200, latency_ms: 100, is_stream: 0, error_message: null,
      created_at: new Date().toISOString(),
    });
    insertRequestLog(db, {
      id: logId2, api_type: "openai", model: "gpt-4", provider_id: "p1",
      status_code: 200, latency_ms: 100, is_stream: 0, error_message: null,
      created_at: new Date().toISOString(),
    });

    insertMetrics(db, {
      request_log_id: logId1, provider_id: "p1", backend_model: "gpt-4", api_type: "openai",
      input_tokens: 100, output_tokens: 50, cache_read_tokens: 20, is_complete: 1,
      client_type: "claude-code",
    });
    insertMetrics(db, {
      request_log_id: logId2, provider_id: "p1", backend_model: "gpt-4", api_type: "openai",
      input_tokens: 200, output_tokens: 100, cache_read_tokens: 30, is_complete: 1,
      client_type: "pi",
    });

    const all = getMetricsSummary(db, "24h");
    expect(all).toHaveLength(2);

    const cc = getMetricsSummary(db, "24h", undefined, undefined, undefined, undefined, undefined, "claude-code");
    expect(cc).toHaveLength(1);
    expect(cc[0].client_type).toBe("claude-code");

    const pi = getMetricsSummary(db, "24h", undefined, undefined, undefined, undefined, undefined, "pi");
    expect(pi).toHaveLength(1);
    expect(pi[0].client_type).toBe("pi");
  });
});

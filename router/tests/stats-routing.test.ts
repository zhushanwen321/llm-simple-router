import { describe, it, expect, afterEach, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { getStats } from "../src/db/stats.js";

let db: Database.Database;

function setupDb(): Database.Database {
  db = initDatabase(":memory:");
  return db;
}

afterEach(() => {
  if (db) db.close();
});

/** Format a Date as SQLite datetime: YYYY-MM-DD HH:MM:SS */
function toSQLiteDatetime(d: Date): string {
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

/** Insert a row into request_metrics with a specific created_at (SQLite datetime format). */
function seedDetail(
  id: string,
  createdAt: string,
  opts: { providerId?: string; statusCode?: number; inputTokens?: number; outputTokens?: number; totalDurationMs?: number } = {},
) {
  db.prepare(
    `INSERT INTO request_metrics (id, request_log_id, provider_id, backend_model, api_type, status_code, input_tokens, output_tokens, total_duration_ms, is_complete, created_at)
     VALUES (?, NULL, ?, 'gpt-4', 'openai', ?, ?, ?, ?, 1, ?)`,
  ).run(id, opts.providerId ?? "p-1", opts.statusCode ?? 200, opts.inputTokens ?? 100, opts.outputTokens ?? 50, opts.totalDurationMs ?? 500, createdAt);
}

/** Insert a row into metrics_10min with a specific bucket_time (SQLite datetime format). */
function seedAgg(
  bucketTime: string,
  opts: { providerId?: string; requestCount?: number; sumInputTokens?: number; sumOutputTokens?: number; sumTotalDurationMs?: number } = {},
) {
  db.prepare(
    `INSERT INTO metrics_10min (bucket_time, router_key_id, provider_id, backend_model, client_type, api_type, request_count, sum_input_tokens, sum_output_tokens, sum_cache_read_tokens, sum_cache_creation_tokens, sum_total_duration_ms, sum_ttft_ms)
     VALUES (?, '', ?, 'gpt-4', 'unknown', 'openai', ?, ?, ?, 0, 0, ?, 0)`,
  ).run(bucketTime, opts.providerId ?? "p-1", opts.requestCount ?? 1, opts.sumInputTokens ?? 100, opts.sumOutputTokens ?? 50, opts.sumTotalDurationMs ?? 500);
}

describe("getStats with computeBucketBoundary routing", () => {
  beforeEach(() => {
    setupDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("p-1", "Test", "openai", "https://api.openai.com", "key", 1, now, now);
  });

  it("pure detail path: query within current bucket returns successRate", () => {
    // Insert detail data with far-future timestamps (SQLite datetime format)
    const futureTime = "2099-12-31 23:00:00";
    seedDetail("m-future-1", futureTime, { statusCode: 200 });
    seedDetail("m-future-2", futureTime, { statusCode: 500 });

    // Query a range entirely in the future (after current bucket boundary)
    const start = "2099-12-31 22:00:00";
    const end = "2099-12-31 23:59:00";

    const stats = getStats(db, start, end);
    expect(stats.totalRequests).toBe(2);
    expect(stats.successRate).toBe(0.5);
    expect(stats.is_approximate).toBe(false);
  });

  it("pure agg path: all data before current bucket returns null successRate", () => {
    // Insert agg data at a time before the current bucket
    const oneHourAgo = toSQLiteDatetime(new Date(Date.now() - 3600_000));
    seedAgg(oneHourAgo, { requestCount: 5, sumInputTokens: 500, sumOutputTokens: 250 });

    // Query a range entirely before the current bucket (1 day ago to 30 min ago)
    // Use SQLite datetime format to match computeBucketBoundary output
    const start = toSQLiteDatetime(new Date(Date.now() - 86400_000));
    const end = toSQLiteDatetime(new Date(Date.now() - 1800_000));

    const stats = getStats(db, start, end);
    expect(stats.totalRequests).toBe(5);
    expect(stats.successRate).toBeNull();
    expect(stats.is_approximate).toBe(true);
  });

  it("cross-boundary: merges agg + detail segments", () => {
    // Agg data: 1 hour ago (in a completed bucket)
    const aggTime = toSQLiteDatetime(new Date(Date.now() - 3600_000));
    seedAgg(aggTime, { requestCount: 10, sumInputTokens: 1000, sumOutputTokens: 500, sumTotalDurationMs: 5000 });

    // Detail data: now (within current bucket, using SQLite datetime)
    const now = toSQLiteDatetime(new Date());
    seedDetail("m-cross-detail", now, { statusCode: 200, inputTokens: 200, outputTokens: 100, totalDurationMs: 1000 });

    // Query a wide range that spans from 2 hours ago to 1 min from now
    // Use SQLite datetime format to match computeBucketBoundary output
    const start = toSQLiteDatetime(new Date(Date.now() - 7200_000));
    const end = toSQLiteDatetime(new Date(Date.now() + 60_000));

    const stats = getStats(db, start, end);
    expect(stats.totalRequests).toBe(11); // 10 agg + 1 detail
    expect(stats.successRate).not.toBeNull(); // detail has status_code
    expect(stats.totalInputTokens).toBe(1200); // 1000 + 200
    expect(stats.totalOutputTokens).toBe(600); // 500 + 100
    expect(stats.is_approximate).toBe(true);
  });

  it("empty database returns zero stats", () => {
    const start = toSQLiteDatetime(new Date(Date.now() - 3600_000));
    const end = toSQLiteDatetime(new Date(Date.now() + 60_000));

    const stats = getStats(db, start, end);
    expect(stats.totalRequests).toBe(0);
    expect(stats.avgTps).toBe(0);
    expect(stats.totalInputTokens).toBe(0);
    expect(stats.totalOutputTokens).toBe(0);
  });
});

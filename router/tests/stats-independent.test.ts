import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { getStats } from "../src/db/stats.js";
import { getWindowUsage } from "../src/db/usage-windows.js";

let db: Database.Database;

afterEach(() => {
  if (db) db.close();
});

function setupDb(): Database.Database {
  db = initDatabase(":memory:");
  return db;
}

describe("Stats independent of request_logs", () => {
  it("getStats returns correct data after request_logs are deleted", () => {
    const database = setupDb();
    const now = new Date().toISOString();
    const startTime = "2026-01-01 00:00:00";
    const endTime = "2027-01-01 00:00:00";

    // 插入 provider（外键依赖）
    database.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("p-1", "Test", "openai", "https://api.openai.com", "key", 1, now, now);

    // 插入 router_key（外键依赖）
    database.prepare(
      `INSERT INTO router_keys (id, name, key_hash, key_prefix, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("rk-1", "Test Key", "hash", "sk-test", now);

    // 插入 request_log
    database.prepare(
      `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, created_at, router_key_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("log-1", "openai", "gpt-4", "p-1", 200, 100, 0, now, "rk-1");

    // 插入 request_metrics，携带 router_key_id 和 status_code
    database.prepare(
      `INSERT INTO request_metrics (id, request_log_id, provider_id, backend_model, api_type, router_key_id, status_code, input_tokens, output_tokens, total_duration_ms, tokens_per_second, is_complete, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("m-1", "log-1", "p-1", "gpt-4", "openai", "rk-1", 200, 100, 200, 6667, 30, 1, now);

    // 验证统计正确 (avgTps = SUM(output_tokens)*1000/SUM(total_duration_ms) = 200*1000/6667 ≈ 30)
    const statsBefore = getStats(database, startTime, endTime, "rk-1");
    expect(statsBefore.totalRequests).toBe(1);
    expect(statsBefore.successRate).toBe(1);
    expect(statsBefore.totalInputTokens).toBe(100);
    expect(statsBefore.totalOutputTokens).toBe(200);
    expect(Math.round(statsBefore.avgTps)).toBe(30);

    // 删除 request_logs 中的记录
    database.prepare("DELETE FROM request_logs WHERE id = ?").run("log-1");

    // 再次验证统计返回相同数据（证明不依赖日志）
    const statsAfter = getStats(database, startTime, endTime, "rk-1");
    expect(statsAfter.totalRequests).toBe(1);
    expect(statsAfter.successRate).toBe(1);
    expect(statsAfter.totalInputTokens).toBe(100);
    expect(statsAfter.totalOutputTokens).toBe(200);
    expect(Math.round(statsAfter.avgTps)).toBe(30);
  });

  it("getStats successRate distinguishes 2xx from 5xx", () => {
    const database = setupDb();
    const now = new Date().toISOString();
    const startTime = "2026-01-01 00:00:00";
    const endTime = "2027-01-01 00:00:00";

    database.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("p-1", "Test", "openai", "https://api.openai.com", "key", 1, now, now);

    // 一个成功，一个失败，直接从 request_metrics 的 status_code 判断
    database.prepare(
      `INSERT INTO request_metrics (id, request_log_id, provider_id, backend_model, api_type, status_code, input_tokens, output_tokens, is_complete, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("m-ok", null, "p-1", "gpt-4", "openai", 200, 100, 50, 1, now);

    database.prepare(
      `INSERT INTO request_metrics (id, request_log_id, provider_id, backend_model, api_type, status_code, input_tokens, output_tokens, is_complete, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("m-err", null, "p-1", "gpt-4", "openai", 502, 200, 0, 1, now);

    const stats = getStats(database, startTime, endTime);
    expect(stats.totalRequests).toBe(2);
    expect(stats.successRate).toBe(0.5);
  });

  it("getWindowUsage works without request_logs", () => {
    const database = setupDb();
    const now = new Date().toISOString();

    database.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("p-1", "Test", "openai", "https://api.openai.com", "key", 1, now, now);

    // 不创建 request_log，直接插入 metrics（request_log_id 为 NULL）
    database.prepare(
      `INSERT INTO request_metrics (id, request_log_id, provider_id, backend_model, api_type, router_key_id, status_code, input_tokens, output_tokens, is_complete, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("m-1", null, "p-1", "gpt-4", "openai", "rk-1", 200, 100, 50, 1, now);

    const usage = getWindowUsage(database, "2026-01-01 00:00:00", "2027-01-01 00:00:00", "rk-1");
    expect(usage.request_count).toBe(1);
    expect(usage.total_input_tokens).toBe(100);
    expect(usage.total_output_tokens).toBe(50);
  });
});

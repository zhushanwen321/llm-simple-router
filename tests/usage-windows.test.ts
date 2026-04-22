import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import {
  insertWindow,
  getLatestWindow,
  getWindowsInRange,
  getWindowUsage,
} from "../src/db/usage-windows.js";
import { UsageWindowTracker } from "../src/proxy/usage-window-tracker.js";

describe("usage-windows DB layer", () => {
  let db: Database.Database;

  afterEach(() => {
    if (db) db.close();
  });

  function setupDb(): Database.Database {
    db = initDatabase(":memory:");
    return db;
  }

  it("insertWindow stores a window record", () => {
    const database = setupDb();
    const id = insertWindow(database, {
      id: "w-1",
      router_key_id: null,
      start_time: "2026-04-22 10:00:00",
      end_time: "2026-04-22 15:00:00",
    });

    expect(id).toBe("w-1");
    const row = database.prepare("SELECT * FROM usage_windows WHERE id = ?").get("w-1") as any;
    expect(row.start_time).toBe("2026-04-22 10:00:00");
    expect(row.end_time).toBe("2026-04-22 15:00:00");
    expect(row.router_key_id).toBeNull();
  });

  it("getLatestWindow returns the most recent window by start_time DESC", () => {
    const database = setupDb();
    insertWindow(database, {
      id: "w-1",
      router_key_id: null,
      start_time: "2026-04-22 10:00:00",
      end_time: "2026-04-22 15:00:00",
    });
    insertWindow(database, {
      id: "w-2",
      router_key_id: null,
      start_time: "2026-04-22 16:00:00",
      end_time: "2026-04-22 21:00:00",
    });

    const latest = getLatestWindow(database);
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe("w-2");
  });

  it("getLatestWindow can filter by router_key_id", () => {
    const database = setupDb();
    insertWindow(database, {
      id: "w-1",
      router_key_id: "rk-1",
      start_time: "2026-04-22 10:00:00",
      end_time: "2026-04-22 15:00:00",
    });
    insertWindow(database, {
      id: "w-2",
      router_key_id: "rk-2",
      start_time: "2026-04-22 16:00:00",
      end_time: "2026-04-22 21:00:00",
    });

    const latest = getLatestWindow(database, "rk-1");
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe("w-1");
  });

  it("getWindowsInRange returns windows overlapping with given range", () => {
    const database = setupDb();
    insertWindow(database, {
      id: "w-1",
      router_key_id: null,
      start_time: "2026-04-22 10:00:00",
      end_time: "2026-04-22 15:00:00",
    });
    insertWindow(database, {
      id: "w-2",
      router_key_id: null,
      start_time: "2026-04-22 16:00:00",
      end_time: "2026-04-22 21:00:00",
    });

    // 完全包含 w-1
    const overlap1 = getWindowsInRange(database, "2026-04-22 09:00:00", "2026-04-22 12:00:00");
    expect(overlap1).toHaveLength(1);
    expect(overlap1[0].id).toBe("w-1");

    // 与 w-1 和 w-2 都有重叠
    const overlap2 = getWindowsInRange(database, "2026-04-22 14:00:00", "2026-04-22 17:00:00");
    expect(overlap2).toHaveLength(2);

    // 不与任何窗口重叠
    const overlap3 = getWindowsInRange(database, "2026-04-22 22:00:00", "2026-04-23 03:00:00");
    expect(overlap3).toHaveLength(0);
  });

  it("getWindowUsage aggregates request count and tokens for a window", () => {
    const database = setupDb();
    const now = new Date().toISOString();

    // 插入 provider
    database.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("p-1", "Test", "openai", "https://api.openai.com", "key", 1, now, now);

    // 插入 request_log
    database.prepare(
      `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, created_at, router_key_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("log-1", "openai", "gpt-4", "p-1", 200, 100, 0, now, "rk-1");

    // 插入 metrics
    database.prepare(
      `INSERT INTO request_metrics (id, request_log_id, provider_id, backend_model, api_type, input_tokens, output_tokens, is_complete, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("m-1", "log-1", "p-1", "gpt-4", "openai", 100, 50, 1, now);

    const usage = getWindowUsage(database, "2026-04-01 00:00:00", "2026-12-31 23:59:59");
    expect(usage.request_count).toBe(1);
    expect(usage.total_input_tokens).toBe(100);
    expect(usage.total_output_tokens).toBe(50);
  });

  it("getWindowUsage filters by router_key_id", () => {
    const database = setupDb();
    const now = new Date().toISOString();

    database.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("p-1", "Test", "openai", "https://api.openai.com", "key", 1, now, now);

    database.prepare(
      `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, created_at, router_key_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("log-1", "openai", "gpt-4", "p-1", 200, 100, 0, now, "rk-1");

    database.prepare(
      `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, created_at, router_key_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("log-2", "openai", "gpt-4", "p-1", 200, 100, 0, now, "rk-2");

    database.prepare(
      `INSERT INTO request_metrics (id, request_log_id, provider_id, backend_model, api_type, input_tokens, output_tokens, is_complete, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("m-1", "log-1", "p-1", "gpt-4", "openai", 100, 50, 1, now);

    database.prepare(
      `INSERT INTO request_metrics (id, request_log_id, provider_id, backend_model, api_type, input_tokens, output_tokens, is_complete, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("m-2", "log-2", "p-1", "gpt-4", "openai", 200, 80, 1, now);

    const usage = getWindowUsage(database, "2026-04-01 00:00:00", "2026-12-31 23:59:59", "rk-1");
    expect(usage.request_count).toBe(1);
    expect(usage.total_input_tokens).toBe(100);
  });
});

describe("UsageWindowTracker", () => {
  let db: Database.Database;

  afterEach(() => {
    if (db) db.close();
  });

  function setupDb(): Database.Database {
    db = initDatabase(":memory:");
    return db;
  }

  it("recordRequest creates new window when no active window exists", () => {
    const database = setupDb();
    const tracker = new UsageWindowTracker(database);

    tracker.recordRequest("rk-1");

    const windows = database.prepare("SELECT * FROM usage_windows").all() as any[];
    expect(windows).toHaveLength(1);
    expect(windows[0].router_key_id).toBe("rk-1");
  });

  it("recordRequest does not create new window within active window", () => {
    const database = setupDb();
    const tracker = new UsageWindowTracker(database);

    tracker.recordRequest("rk-1");
    tracker.recordRequest("rk-1");

    const windows = database.prepare("SELECT * FROM usage_windows").all() as any[];
    expect(windows).toHaveLength(1);
  });

  it("reconcileOnStartup creates initial window from earliest request", () => {
    const database = setupDb();
    const now = new Date().toISOString();

    // 插入 provider 和 request_log
    database.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("p-1", "Test", "openai", "https://api.openai.com", "key", 1, now, now);

    database.prepare(
      `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("log-1", "openai", "gpt-4", "p-1", 200, 100, 0, now);

    const tracker = new UsageWindowTracker(database);
    tracker.reconcileOnStartup();

    const windows = database.prepare("SELECT * FROM usage_windows").all() as any[];
    expect(windows.length).toBeGreaterThanOrEqual(1);
  });

  it("reconcileOnStartup is no-op when no request logs exist", () => {
    const database = setupDb();
    const tracker = new UsageWindowTracker(database);

    tracker.reconcileOnStartup();

    const windows = database.prepare("SELECT * FROM usage_windows").all() as any[];
    expect(windows).toHaveLength(0);
  });
});

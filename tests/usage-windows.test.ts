import { describe, it, expect, afterEach, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { FastifyInstance } from "fastify";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { hashPassword } from "../src/utils/password.js";
import { buildApp } from "../src/index.js";
import {
  insertWindow,
  getLatestWindow,
  getWindowsInRange,
  getWindowUsage,
} from "../src/db/usage-windows.js";
import { UsageWindowTracker } from "../src/proxy/usage-window-tracker.js";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function makeConfig() {
  return {
    PORT: 9981,
    DB_PATH: ":memory:",
    LOG_LEVEL: "silent",
    TZ: "Asia/Shanghai",
    STREAM_TIMEOUT_MS: 5000,
    RETRY_BASE_DELAY_MS: 0,
  };
}

function seedSettings(db: ReturnType<typeof initDatabase>) {
  setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
  setSetting(db, "jwt_secret", "test-jwt-secret-for-testing");
  setSetting(db, "admin_password_hash", hashPassword("test-admin-pass"));
  setSetting(db, "initialized", "true");
}

async function login(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/login",
    payload: { password: "test-admin-pass" },
  });
  const match = (res.headers["set-cookie"] as string).match(/admin_token=([^;]+)/);
  return `admin_token=${match![1]}`;
}

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
      `INSERT INTO request_metrics (id, request_log_id, provider_id, backend_model, api_type, router_key_id, status_code, input_tokens, output_tokens, is_complete, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("m-1", "log-1", "p-1", "gpt-4", "openai", "rk-1", 200, 100, 50, 1, now);

    database.prepare(
      `INSERT INTO request_metrics (id, request_log_id, provider_id, backend_model, api_type, router_key_id, status_code, input_tokens, output_tokens, is_complete, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("m-2", "log-2", "p-1", "gpt-4", "openai", "rk-2", 200, 200, 80, 1, now);

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

    tracker.recordRequest("p-1", "rk-1");

    const windows = database.prepare("SELECT * FROM usage_windows").all() as any[];
    expect(windows).toHaveLength(1);
    expect(windows[0].router_key_id).toBe("rk-1");
    expect(windows[0].provider_id).toBe("p-1");
  });

  it("recordRequest does not create new window within active window", () => {
    const database = setupDb();
    const tracker = new UsageWindowTracker(database);

    tracker.recordRequest("p-1", "rk-1");
    tracker.recordRequest("p-1", "rk-1");

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

  it("recordRequest creates per-provider windows independently", () => {
    const database = setupDb();
    const tracker = new UsageWindowTracker(database);

    tracker.recordRequest("p-1");
    tracker.recordRequest("p-2");

    const windows = database.prepare("SELECT * FROM usage_windows ORDER BY provider_id ASC").all() as any[];
    expect(windows).toHaveLength(2);
    expect(windows[0].provider_id).toBe("p-1");
    expect(windows[1].provider_id).toBe("p-2");
  });

  it("getLatestWindow filters by provider_id", () => {
    const database = setupDb();
    insertWindow(database, {
      id: "w-1",
      router_key_id: null,
      provider_id: "p-1",
      start_time: "2026-04-22 10:00:00",
      end_time: "2026-04-22 15:00:00",
    });
    insertWindow(database, {
      id: "w-2",
      router_key_id: null,
      provider_id: "p-2",
      start_time: "2026-04-22 16:00:00",
      end_time: "2026-04-22 21:00:00",
    });

    // p-1 的最新窗口是 w-1
    const latestP1 = getLatestWindow(database, undefined, "p-1");
    expect(latestP1).not.toBeNull();
    expect(latestP1!.id).toBe("w-1");

    // p-2 的最新窗口是 w-2
    const latestP2 = getLatestWindow(database, undefined, "p-2");
    expect(latestP2).not.toBeNull();
    expect(latestP2!.id).toBe("w-2");

    // 无 provider 时（全局窗口），不应找到任何带 provider_id 的窗口
    const globalLatest = getLatestWindow(database);
    expect(globalLatest).toBeNull();
  });

  it("getWindowsInRange filters by provider_id", () => {
    const database = setupDb();
    insertWindow(database, {
      id: "w-1",
      router_key_id: null,
      provider_id: "p-1",
      start_time: "2026-04-22 10:00:00",
      end_time: "2026-04-22 15:00:00",
    });
    insertWindow(database, {
      id: "w-2",
      router_key_id: null,
      provider_id: "p-2",
      start_time: "2026-04-22 10:00:00",
      end_time: "2026-04-22 15:00:00",
    });

    const p1Windows = getWindowsInRange(database, "2026-04-22 09:00:00", "2026-04-22 16:00:00", undefined, "p-1");
    expect(p1Windows).toHaveLength(1);
    expect(p1Windows[0].id).toBe("w-1");

    const p2Windows = getWindowsInRange(database, "2026-04-22 09:00:00", "2026-04-22 16:00:00", undefined, "p-2");
    expect(p2Windows).toHaveLength(1);
    expect(p2Windows[0].id).toBe("w-2");
  });
});

describe("usage API endpoints", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof initDatabase>;
  let close: () => Promise<void>;
  let cookie: string;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    seedSettings(db);
    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);
  });

  afterEach(async () => {
    await close();
  });

  it("GET /admin/api/usage/windows returns today's windows with usage", async () => {
    const now = new Date();
    const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    // 使用本地格式时间，确保在窗口范围内（ISO UTC 时间可能落在前一天导致字符串比较失败）
    const nowLocal = `${todayLocal} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

    db.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("p-1", "Test", "openai", "https://api.openai.com", "key", 1, nowLocal, nowLocal);

    insertWindow(db, {
      id: "w-today",
      router_key_id: null,
      start_time: `${todayLocal} 00:00:00`,
      end_time: `${todayLocal} 23:59:59`,
    });

    db.prepare(
      `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, created_at, router_key_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("log-1", "openai", "gpt-4", "p-1", 200, 100, 0, nowLocal, null);

    db.prepare(
      `INSERT INTO request_metrics (id, request_log_id, provider_id, backend_model, api_type, input_tokens, output_tokens, is_complete, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("m-1", "log-1", "p-1", "gpt-4", "openai", 100, 50, 1, nowLocal);

    const res = await app.inject({
      method: "GET",
      url: "/admin/api/usage/windows",
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0]).toHaveProperty("window");
    expect(body[0]).toHaveProperty("usage");
    expect(body[0].usage.request_count).toBe(1);
    expect(body[0].usage.total_input_tokens).toBe(100);
    expect(body[0].usage.total_output_tokens).toBe(50);
  });

  it("GET /admin/api/usage/windows supports router_key_id filter", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/usage/windows?router_key_id=test-key",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("GET /admin/api/usage/weekly returns daily aggregation", async () => {
    const now = new Date(Date.now() - 1000).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");

    db.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("p-1", "Test", "openai", "https://api.openai.com", "key", 1, now, now);

    db.prepare(
      `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("log-1", "openai", "gpt-4", "p-1", 200, 100, 0, now);

    db.prepare(
      `INSERT INTO request_metrics (id, request_log_id, provider_id, backend_model, api_type, input_tokens, output_tokens, is_complete, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("m-1", "log-1", "p-1", "gpt-4", "openai", 200, 80, 1, now);

    const res = await app.inject({
      method: "GET",
      url: "/admin/api/usage/weekly",
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0]).toHaveProperty("date");
    expect(body[0]).toHaveProperty("request_count");
    expect(body[0]).toHaveProperty("total_input_tokens");
    expect(body[0]).toHaveProperty("total_output_tokens");
  });

  it("GET /admin/api/usage/monthly returns daily aggregation", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/usage/monthly",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });
});

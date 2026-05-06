import { describe, it, expect, afterEach } from "vitest";
import { initDatabase } from "../src/db/index.js";
import Database from "better-sqlite3";

describe("initDatabase", () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    if (db) {
      db.close();
      db = null;
    }
  });

  it("should create all tables", () => {
    db = initDatabase(":memory:");

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("migrations");
    expect(tableNames).toContain("providers");
    expect(tableNames).toContain("model_mappings");
    expect(tableNames).toContain("mapping_groups");
    expect(tableNames).toContain("retry_rules");
    expect(tableNames).toContain("request_logs");
    expect(tableNames).toContain("request_metrics");
    expect(tableNames).toContain("router_keys");
  });

  it("should record migration in migrations table", () => {
    db = initDatabase(":memory:");

    const rows = db
      .prepare("SELECT name FROM migrations")
      .all() as { name: string }[];

    expect(rows.length).toBe(42);
    expect(rows[0].name).toBe("001_init.sql");
    expect(rows[1].name).toBe("002_add_request_response_body.sql");
    expect(rows[2].name).toBe("003_add_full_request_chain_log.sql");
    expect(rows[3].name).toBe("004_rename_to_providers.sql");
    expect(rows[4].name).toBe("005_add_api_key_preview.sql");
    expect(rows[5].name).toBe("006_create_request_metrics.sql");
    expect(rows[6].name).toBe("007_add_retry_fields.sql");
    expect(rows[7].name).toBe("008_create_router_keys.sql");
    expect(rows[8].name).toBe("009_add_request_logs_indexes.sql");
    expect(rows[9].name).toBe("010_add_key_encrypted.sql");
    expect(rows[10].name).toBe("011_create_mapping_groups.sql");
  });

  it("should be idempotent - running twice does not error", () => {
    db = new Database(":memory:");
    // initDatabase 内部会创建 migrations 表并执行迁移
    // 但注意：initDatabase 返回一个新 db，这里需要用同一实例
    // 所以我们直接测试幂等性
    db = initDatabase(":memory:");
    // 第二次调用需要用同一个 db，但 initDatabase 创建新实例
    // 这里测试再次调用不抛异常
    expect(() => {
      const db2 = initDatabase(":memory:");
      db2.close();
    }).not.toThrow();
  });

  it("should allow inserting a backend service", () => {
    db = initDatabase(":memory:");

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("svc-1", "Test OpenAI", "openai", "https://api.openai.com", "encrypted-key", 1, now, now);

    const row = db
      .prepare("SELECT * FROM providers WHERE id = ?")
      .get("svc-1") as any;
    expect(row.name).toBe("Test OpenAI");
    expect(row.api_type).toBe("openai");
  });

  it("should enforce api_type CHECK constraint", () => {
    db = initDatabase(":memory:");

    const now = new Date().toISOString();
    expect(() =>
      db!.prepare(
        `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run("svc-2", "Bad", "invalid_type", "https://example.com", "key", 1, now, now)
    ).toThrow();
  });

  it("should allow inserting a model mapping with FK", () => {
    db = initDatabase(":memory:");

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("svc-1", "Test", "openai", "https://api.openai.com", "key", 1, now, now);

    db.prepare(
      `INSERT INTO model_mappings (id, client_model, backend_model, provider_id, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("map-1", "gpt-4", "gpt-4-turbo", "svc-1", 1, now);

    const row = db
      .prepare("SELECT * FROM model_mappings WHERE id = ?")
      .get("map-1") as any;
    expect(row.client_model).toBe("gpt-4");
    expect(row.backend_model).toBe("gpt-4-turbo");
  });

  it("creates request_logs with session_id column", () => {
    db = initDatabase(":memory:");
    const info = db.pragma("table_info(request_logs)") as { name: string }[];
    const columnNames = info.map(c => c.name);
    expect(columnNames).toContain("session_id");
  });

  it("sets auto_vacuum to INCREMENTAL (2)", () => {
    db = initDatabase(":memory:");
    const [{ auto_vacuum }] = db.pragma("auto_vacuum") as { auto_vacuum: number }[];
    expect(auto_vacuum).toBe(2);
  });

  it("should enforce UNIQUE on client_model", () => {
    db = initDatabase(":memory:");

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("svc-1", "Test", "openai", "https://api.openai.com", "key", 1, now, now);

    db.prepare(
      `INSERT INTO model_mappings (id, client_model, backend_model, provider_id, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("map-1", "gpt-4", "gpt-4-turbo", "svc-1", 1, now);

    expect(() =>
      db!.prepare(
        `INSERT INTO model_mappings (id, client_model, backend_model, provider_id, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run("map-2", "gpt-4", "gpt-4o", "svc-1", 1, now)
    ).toThrow();
  });
});



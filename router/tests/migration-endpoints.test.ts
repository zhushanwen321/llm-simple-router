import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { encrypt } from "../src/utils/crypto.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATION_SQL = readFileSync(
  join(__dirname, "../src/db/migrations/051_provider_endpoints.sql"),
  "utf-8",
);

// 提取 UPDATE 语句（幂等性测试需要单独运行 UPDATE 部分）
const UPDATE_SQL = MIGRATION_SQL.match(/UPDATE providers[\s\S]*;/)?.[0] ?? "";


const TEST_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/**
 * 创建模拟迁移前状态的 providers 表（不含 endpoints 列）。
 * Schema 基于 036 + 038(upstream_path) + 041(proxy) 迁移。
 */
function createPreMigrationSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      api_type TEXT NOT NULL CHECK(api_type IN ('openai', 'openai-responses', 'anthropic')),
      base_url TEXT NOT NULL,
      upstream_path TEXT DEFAULT NULL,
      api_key TEXT NOT NULL,
      api_key_preview TEXT,
      models TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1,
      max_concurrency INTEGER NOT NULL DEFAULT 0,
      queue_timeout_ms INTEGER NOT NULL DEFAULT 0,
      max_queue_size INTEGER NOT NULL DEFAULT 100,
      adaptive_enabled INTEGER NOT NULL DEFAULT 0,
      proxy_type TEXT DEFAULT NULL,
      proxy_url TEXT DEFAULT NULL,
      proxy_username TEXT DEFAULT NULL,
      proxy_password TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

describe("Migration 051: provider endpoints", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
  });

  // TC-1-01: Migration converts old fields to endpoints JSON
  it("TC-1-01: converts old api_type/base_url/api_key to endpoints", () => {
    createPreMigrationSchema(db);

    // Provider 1: 无 upstream_path（常见场景）
    const apiKey1 = encrypt("sk-openai-key", TEST_KEY);
    db.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active, max_concurrency, queue_timeout_ms, max_queue_size, adaptive_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "p1",
      "OpenAIProvider",
      "openai",
      "https://api.openai.com",
      apiKey1,
      "[]",
      1, 0, 0, 100, 0,
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
    );

    // Provider 2: anthropic + 无 upstream_path
    const apiKey2 = encrypt("sk-ant-key", TEST_KEY);
    db.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active, max_concurrency, queue_timeout_ms, max_queue_size, adaptive_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "p2",
      "AnthropicProvider",
      "anthropic",
      "https://api.anthropic.com",
      apiKey2,
      "[]",
      1, 0, 0, 100, 0,
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
    );

    // 执行迁移
    db.exec(MIGRATION_SQL);

    // 验证 p1
    const p1 = db.prepare("SELECT endpoints FROM providers WHERE id = ?").get("p1") as { endpoints: string | null };
    expect(p1.endpoints).not.toBeNull();
    const ep1 = JSON.parse(p1.endpoints!);
    expect(ep1).toHaveLength(1);
    expect(ep1[0].api_type).toBe("openai");
    expect(ep1[0].base_url).toBe("https://api.openai.com");
    expect(ep1[0].upstream_path).toBeNull();
    expect(ep1[0].api_key).toBe(apiKey1);

    // 验证 p2
    const p2 = db.prepare("SELECT endpoints FROM providers WHERE id = ?").get("p2") as { endpoints: string | null };
    const ep2 = JSON.parse(p2.endpoints!);
    expect(ep2).toHaveLength(1);
    expect(ep2[0].api_type).toBe("anthropic");
    expect(ep2[0].base_url).toBe("https://api.anthropic.com");
    expect(ep2[0].upstream_path).toBeNull();
    expect(ep2[0].api_key).toBe(apiKey2);
  });

  // TC-1-02: Migration UPDATE is idempotent
  it("TC-1-02: re-running UPDATE portion does not change endpoints", () => {
    createPreMigrationSchema(db);

    const apiKey = encrypt("sk-test-key", TEST_KEY);
    db.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active, max_concurrency, queue_timeout_ms, max_queue_size, adaptive_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "p1",
      "TestProvider",
      "openai",
      "https://api.openai.com",
      apiKey,
      "[]",
      1, 0, 0, 100, 0,
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
    );

    // ALTER TABLE（只执行一次）
    db.exec("ALTER TABLE providers ADD COLUMN endpoints TEXT DEFAULT NULL;");

    // 第一次 UPDATE
    db.exec(UPDATE_SQL);
    const afterFirst = (db.prepare("SELECT endpoints FROM providers WHERE id = ?").get("p1") as { endpoints: string | null }).endpoints;

    // 第二次 UPDATE（幂等性：WHERE endpoints IS NULL 不会匹配已填充的行）
    db.exec(UPDATE_SQL);
    const afterSecond = (db.prepare("SELECT endpoints FROM providers WHERE id = ?").get("p1") as { endpoints: string | null }).endpoints;

    expect(afterFirst).toBe(afterSecond);
    expect(afterFirst).not.toBeNull();

    const parsed = JSON.parse(afterFirst!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].api_type).toBe("openai");
  });

  it("migration handles empty providers table", () => {
    createPreMigrationSchema(db);
    // 不插入任何数据 — 迁移不应报错
    db.exec(MIGRATION_SQL);
    const count = (db.prepare("SELECT COUNT(*) as cnt FROM providers").get() as { cnt: number }).cnt;
    expect(count).toBe(0);
  });
});

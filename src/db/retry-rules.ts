import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { buildUpdateQuery, deleteById } from "./helpers.js";

export interface RetryRule {
  id: string;
  name: string;
  status_code: number;
  body_pattern: string;
  is_active: number;
  created_at: string;
  retry_strategy: "fixed" | "exponential";
  retry_delay_ms: number;
  max_retries: number;
  max_delay_ms: number;
}

const RETRY_FIELDS = new Set(["name", "status_code", "body_pattern", "is_active", "retry_strategy", "retry_delay_ms", "max_retries", "max_delay_ms"]);

const DEFAULT_RETRY_DELAY_MS = 5000;
const DEFAULT_MAX_RETRIES = 10;
const DEFAULT_MAX_DELAY_MS = 60000;

export function getActiveRetryRules(db: Database.Database): RetryRule[] {
  return db
    .prepare("SELECT * FROM retry_rules WHERE is_active = 1 ORDER BY created_at DESC")
    .all() as RetryRule[];
}

export function getAllRetryRules(db: Database.Database): RetryRule[] {
  return db
    .prepare("SELECT * FROM retry_rules ORDER BY created_at DESC")
    .all() as RetryRule[];
}

export function createRetryRule(
  db: Database.Database,
  rule: {
    name: string; status_code: number; body_pattern: string; is_active?: number;
    retry_strategy?: string; retry_delay_ms?: number; max_retries?: number; max_delay_ms?: number;
  },
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at, retry_strategy, retry_delay_ms, max_retries, max_delay_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, rule.name, rule.status_code, rule.body_pattern, rule.is_active ?? 1, now,
    rule.retry_strategy ?? "exponential", rule.retry_delay_ms ?? DEFAULT_RETRY_DELAY_MS, rule.max_retries ?? DEFAULT_MAX_RETRIES, rule.max_delay_ms ?? DEFAULT_MAX_DELAY_MS);
  return id;
}

export function updateRetryRule(
  db: Database.Database,
  id: string,
  fields: Partial<Pick<RetryRule, "name" | "status_code" | "body_pattern" | "is_active" | "retry_strategy" | "retry_delay_ms" | "max_retries" | "max_delay_ms">>,
): void {
  buildUpdateQuery(db, "retry_rules", id, fields, RETRY_FIELDS);
}

export function deleteRetryRule(db: Database.Database, id: string): void {
  deleteById(db, "retry_rules", id);
}

// ---------- Default seed rules ----------

const DEFAULT_RULES: Omit<RetryRule, "id" | "created_at">[] = [
  { name: "429 Too Many Requests", status_code: 429, body_pattern: ".*", is_active: 1, retry_strategy: "exponential", retry_delay_ms: 5000, max_retries: 10, max_delay_ms: 60000 },
  { name: "503 Service Unavailable", status_code: 503, body_pattern: ".*", is_active: 1, retry_strategy: "exponential", retry_delay_ms: 5000, max_retries: 10, max_delay_ms: 60000 },
  { name: 'ZAI 网络错误 (code 1234)', status_code: 400, body_pattern: '"type"\\s*:\\s*"error".*"code"\\s*:\\s*"1234"', is_active: 1, retry_strategy: "exponential", retry_delay_ms: 5000, max_retries: 10, max_delay_ms: 60000 },
  { name: 'ZAI 临时不可用', status_code: 400, body_pattern: '"type"\\s*:\\s*"error".*请稍后重试', is_active: 1, retry_strategy: "exponential", retry_delay_ms: 5000, max_retries: 10, max_delay_ms: 60000 },
  { name: 'ZAI 操作失败 (code 500)', status_code: 400, body_pattern: '"type"\\s*:\\s*"error".*"code"\\s*:\\s*"500"', is_active: 1, retry_strategy: "exponential", retry_delay_ms: 5000, max_retries: 10, max_delay_ms: 60000 },
  { name: 'ZAI 速率限制 (HTTP 200, code 1302)', status_code: 200, body_pattern: '"error".*"code"\\s*:\\s*"1302"', is_active: 1, retry_strategy: "exponential", retry_delay_ms: 5000, max_retries: 10, max_delay_ms: 60000 },
  { name: 'ZAI SSE 错误 (HTTP 200, code 500)', status_code: 200, body_pattern: '"error".*"code"\\s*:\\s*"500"', is_active: 1, retry_strategy: "exponential", retry_delay_ms: 5000, max_retries: 10, max_delay_ms: 60000 },
  { name: 'ZAI SSE 错误 (HTTP 200, code 1234)', status_code: 200, body_pattern: '"error".*"code"\\s*:\\s*"1234"', is_active: 1, retry_strategy: "exponential", retry_delay_ms: 5000, max_retries: 10, max_delay_ms: 60000 },
];

/**
 * 启动时按名称查重插入默认重试规则。
 * 已存在的规则不会被重复插入或覆盖。
 */
export function seedDefaultRules(db: Database.Database): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at, retry_strategy, retry_delay_ms, max_retries, max_delay_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const rule of DEFAULT_RULES) {
    const existing = db.prepare("SELECT 1 FROM retry_rules WHERE name = ?").get(rule.name);
    if (!existing) {
      insert.run(randomUUID(), rule.name, rule.status_code, rule.body_pattern, rule.is_active, now,
        rule.retry_strategy, rule.retry_delay_ms, rule.max_retries, rule.max_delay_ms);
    }
  }
}

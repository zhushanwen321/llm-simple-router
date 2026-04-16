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
}

const RETRY_FIELDS = new Set(["name", "status_code", "body_pattern", "is_active"]);

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
  rule: { name: string; status_code: number; body_pattern: string; is_active?: number },
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, rule.name, rule.status_code, rule.body_pattern, rule.is_active ?? 1, now);
  return id;
}

export function updateRetryRule(
  db: Database.Database,
  id: string,
  fields: Partial<Pick<RetryRule, "name" | "status_code" | "body_pattern" | "is_active">>,
): void {
  buildUpdateQuery(db, "retry_rules", id, fields, RETRY_FIELDS);
}

export function deleteRetryRule(db: Database.Database, id: string): void {
  deleteById(db, "retry_rules", id);
}

// ---------- Default seed rules ----------

const DEFAULT_RULES: Omit<RetryRule, "id" | "created_at">[] = [
  { name: "429 Too Many Requests", status_code: 429, body_pattern: ".*", is_active: 1 },
  { name: "503 Service Unavailable", status_code: 503, body_pattern: ".*", is_active: 1 },
  { name: 'ZAI 网络错误 (code 1234)', status_code: 400, body_pattern: '"type"\\s*:\\s*"error".*"code"\\s*:\\s*"1234"', is_active: 1 },
  { name: 'ZAI 临时不可用', status_code: 400, body_pattern: '"type"\\s*:\\s*"error".*请稍后重试', is_active: 1 },
  { name: 'ZAI 操作失败 (code 500)', status_code: 400, body_pattern: '"type"\\s*:\\s*"error".*"code"\\s*:\\s*"500"', is_active: 1 },
];

/**
 * 首次启动时（表为空）插入默认重试规则。
 * 429/503 为通用 HTTP 重试；其余为 ZAI middleware 特定 400 响应。
 */
export function seedDefaultRules(db: Database.Database): void {
  const count = (db.prepare("SELECT COUNT(*) as c FROM retry_rules").get() as { c: number }).c;
  if (count > 0) return;
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const rule of DEFAULT_RULES) {
    insert.run(randomUUID(), rule.name, rule.status_code, rule.body_pattern, rule.is_active, now);
  }
}

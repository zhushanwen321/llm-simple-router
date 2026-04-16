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

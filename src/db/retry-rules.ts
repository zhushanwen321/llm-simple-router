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


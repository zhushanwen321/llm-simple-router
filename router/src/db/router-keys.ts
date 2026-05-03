import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { buildUpdateQuery, deleteById } from "./helpers.js";

export interface RouterKey {
  id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  key_encrypted: string | null;
  allowed_models: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export function getRouterKeyByHash(db: Database.Database, hash: string): { id: string; name: string; allowed_models: string | null } | undefined {
  return db.prepare("SELECT id, name, allowed_models FROM router_keys WHERE key_hash = ? AND is_active = 1").get(hash) as { id: string; name: string; allowed_models: string | null } | undefined;
}

export function getAllRouterKeys(db: Database.Database): RouterKey[] {
  return db.prepare("SELECT * FROM router_keys ORDER BY created_at DESC").all() as RouterKey[];
}

export function getRouterKeyById(db: Database.Database, id: string): RouterKey | undefined {
  return db.prepare("SELECT * FROM router_keys WHERE id = ?").get(id) as RouterKey | undefined;
}

export function createRouterKey(
  db: Database.Database,
  key: { name: string; key_hash: string; key_prefix: string; key_encrypted: string; allowed_models?: string | null }
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO router_keys (id, name, key_hash, key_prefix, key_encrypted, allowed_models, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(id, key.name, key.key_hash, key.key_prefix, key.key_encrypted, key.allowed_models ?? null, now, now);
  return id;
}

const ROUTER_KEY_FIELDS = new Set(["name", "allowed_models", "is_active"]);

export function updateRouterKey(
  db: Database.Database,
  id: string,
  fields: Partial<Pick<RouterKey, "name" | "allowed_models" | "is_active">>,
): void {
  buildUpdateQuery(db, "router_keys", id, fields, ROUTER_KEY_FIELDS, { updatedAt: true });
}

export function deleteRouterKey(db: Database.Database, id: string): void {
  deleteById(db, "router_keys", id);
}

export function getAvailableModels(db: Database.Database): string[] {
  const rows = db.prepare("SELECT models FROM providers WHERE is_active = 1").all() as { models: string }[];
  const set = new Set<string>();
  for (const r of rows) {
    try { JSON.parse(r.models || "[]").forEach((m: string) => set.add(m)); } catch { continue }
  }
  return [...set].sort();
}

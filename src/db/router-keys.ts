import Database from "better-sqlite3";
import { randomUUID } from "crypto";

export interface RouterKey {
  id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
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
  key: { name: string; key_hash: string; key_prefix: string; allowed_models?: string | null }
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO router_keys (id, name, key_hash, key_prefix, allowed_models, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(id, key.name, key.key_hash, key.key_prefix, key.allowed_models ?? null, now, now);
  return id;
}

export function updateRouterKey(db: Database.Database, id: string, fields: Partial<Pick<RouterKey, 'name' | 'allowed_models' | 'is_active'>>): void {
  const ALLOWED = new Set(['name', 'allowed_models', 'is_active']);
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [k, value] of Object.entries(fields)) {
    if (!ALLOWED.has(k)) continue;
    sets.push(`${k} = ?`);
    values.push(value);
  }
  sets.push("updated_at = ?");
  values.push(new Date().toISOString(), id);
  db.prepare(`UPDATE router_keys SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteRouterKey(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM router_keys WHERE id = ?").run(id);
}

export function getAvailableModels(db: Database.Database): string[] {
  const rows = db.prepare("SELECT DISTINCT backend_model FROM model_mappings ORDER BY backend_model").all() as { backend_model: string }[];
  return rows.map(r => r.backend_model);
}

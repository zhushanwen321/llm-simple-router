import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { buildUpdateQuery, deleteById } from "./helpers.js";

export interface Provider {
  id: string;
  name: string;
  api_type: "openai" | "anthropic";
  base_url: string;
  api_key: string;
  api_key_preview?: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

const PROVIDER_FIELDS = new Set([
  "name", "api_type", "base_url", "api_key", "api_key_preview", "is_active",
]);

export function getActiveProviders(
  db: Database.Database,
  apiType: "openai" | "anthropic",
): Provider[] {
  return db
    .prepare("SELECT * FROM providers WHERE api_type = ? AND is_active = 1")
    .all(apiType) as Provider[];
}

export function getAllProviders(db: Database.Database): Provider[] {
  return db.prepare("SELECT * FROM providers ORDER BY created_at DESC").all() as Provider[];
}

export function getProviderById(db: Database.Database, id: string): Provider | undefined {
  return db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as Provider | undefined;
}

export function createProvider(
  db: Database.Database,
  provider: {
    name: string;
    api_type: "openai" | "anthropic";
    base_url: string;
    api_key: string;
    api_key_preview?: string;
    is_active?: number;
  },
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, api_key, api_key_preview, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, provider.name, provider.api_type, provider.base_url,
    provider.api_key, provider.api_key_preview ?? null,
    provider.is_active ?? 1, now, now,
  );
  return id;
}

export function updateProvider(
  db: Database.Database,
  id: string,
  fields: Partial<Pick<Provider, "name" | "api_type" | "base_url" | "api_key" | "api_key_preview" | "is_active">>,
): void {
  buildUpdateQuery(db, "providers", id, fields, PROVIDER_FIELDS, { updatedAt: true });
}

export function deleteProvider(db: Database.Database, id: string): void {
  deleteById(db, "providers", id);
}

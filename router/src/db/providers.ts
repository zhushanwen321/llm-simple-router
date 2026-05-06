import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { buildUpdateQuery, deleteById } from "./helpers.js";

export interface Provider {
  id: string;
  name: string;
  api_type: "openai" | "openai-responses" | "anthropic";
  base_url: string;
  upstream_path: string | null;
  api_key: string;
  api_key_preview?: string;
  models: string; // JSON 数组文本
  is_active: number;
  max_concurrency: number;
  queue_timeout_ms: number;
  max_queue_size: number;
  adaptive_enabled: number;
  created_at: string;
  updated_at: string;
}

/** 默认流式超时 10 分钟 */
export const DEFAULT_STREAM_TIMEOUT_MS = 600_000;

/** 从 provider 的 models JSON 中查找指定模型的超时值 */
export function getModelStreamTimeout(
  provider: Provider,
  backendModel: string,
): number {
  try {
    const raw = JSON.parse(provider.models);
    if (!Array.isArray(raw)) return DEFAULT_STREAM_TIMEOUT_MS;
    for (const m of raw) {
      if (typeof m === "string") {
        if (m === backendModel) return DEFAULT_STREAM_TIMEOUT_MS;
        continue;
      }
      const obj = m as Record<string, unknown>;
      if (!obj || typeof obj !== "object") continue;
      const modelId = (obj.name ?? obj.id) as string | undefined;
      if (modelId === backendModel) {
        const timeout = obj.stream_timeout_ms as number | undefined;
        // stream_timeout_ms: 0 表示禁用超时，返回 Infinity；
        // undefined/null/未设置 表示使用默认值
        if (timeout === 0) return Number.POSITIVE_INFINITY;
        return timeout ?? DEFAULT_STREAM_TIMEOUT_MS;
      }
    }
  } catch { /* ignore parse errors — models field may be empty or invalid */ } // eslint-disable-line taste/no-silent-catch
  return DEFAULT_STREAM_TIMEOUT_MS;
}

export const PROVIDER_CONCURRENCY_DEFAULTS = {
  max_concurrency: 0,
  queue_timeout_ms: 0,
  max_queue_size: 100,
} as const;

const PROVIDER_FIELDS = new Set([
  "name", "api_type", "base_url", "upstream_path", "api_key", "api_key_preview", "models", "is_active", "max_concurrency", "queue_timeout_ms", "max_queue_size", "adaptive_enabled",
]);

export function getActiveProviders(
  db: Database.Database,
  apiType: "openai" | "openai-responses" | "anthropic",
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
    api_type: "openai" | "openai-responses" | "anthropic";
    base_url: string;
    upstream_path?: string | null;
    api_key: string;
    api_key_preview?: string;
    models?: string;
    is_active?: number;
    max_concurrency?: number;
    queue_timeout_ms?: number;
    max_queue_size?: number;
    adaptive_enabled?: number;
  },
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, upstream_path, api_key, api_key_preview, models, is_active, max_concurrency, queue_timeout_ms, max_queue_size, adaptive_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, provider.name, provider.api_type, provider.base_url,
    provider.upstream_path ?? null,
    provider.api_key, provider.api_key_preview ?? null,
    provider.models ?? "[]",
    provider.is_active ?? 1,
    provider.max_concurrency ?? PROVIDER_CONCURRENCY_DEFAULTS.max_concurrency,
    provider.queue_timeout_ms ?? PROVIDER_CONCURRENCY_DEFAULTS.queue_timeout_ms,
    provider.max_queue_size ?? PROVIDER_CONCURRENCY_DEFAULTS.max_queue_size,
    provider.adaptive_enabled ?? 0,
    now, now,
  );
  return id;
}

export function updateProvider(
  db: Database.Database,
  id: string,
  fields: Partial<Pick<Provider, "name" | "api_type" | "base_url" | "upstream_path" | "api_key" | "api_key_preview" | "models" | "is_active" | "max_concurrency" | "queue_timeout_ms" | "max_queue_size" | "adaptive_enabled">>,
): void {
  buildUpdateQuery(db, "providers", id, fields, PROVIDER_FIELDS, { updatedAt: true });
}

export function deleteProvider(db: Database.Database, id: string): void {
  deleteById(db, "providers", id);
}

export function getActiveProviderByName(db: Database.Database, name: string): { id: string; models: string } | undefined {
  return db.prepare("SELECT id, models FROM providers WHERE name = ? AND is_active = 1").get(name) as { id: string; models: string } | undefined;
}

export function getActiveProvidersWithModels(db: Database.Database): { id: string; name: string; models: string }[] {
  return db.prepare("SELECT id, name, models FROM providers WHERE is_active = 1").all() as { id: string; name: string; models: string }[];
}

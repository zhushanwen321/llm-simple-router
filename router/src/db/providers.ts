import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { buildUpdateQuery, deleteById } from "./helpers.js";
import { parseModels } from "../config/model-context.js";

export interface Provider {
  id: string;
  name: string;
  api_type: "openai" | "openai-responses" | "anthropic";
  base_url: string;
  upstream_path: string | null;
  api_key: string;
  api_key_preview?: string;
  /** @internal 原始 JSON 文本，业务层请使用 parseModels() 解析，禁止直接 JSON.parse */
  models: string;
  is_active: number;
  max_concurrency: number;
  queue_timeout_ms: number;
  max_queue_size: number;
  adaptive_enabled: number;
  proxy_type: string | null;
  proxy_url: string | null;
  proxy_username: string | null;
  proxy_password: string | null;
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
  const entries = parseModels(provider.models);
  const entry = entries.find(m => m.name === backendModel);
  if (!entry) return DEFAULT_STREAM_TIMEOUT_MS;
  const timeout = entry.stream_timeout_ms;
  // stream_timeout_ms: 0 表示禁用超时，返回 Infinity；
  // undefined/null/未设置 表示使用默认值
  if (timeout === 0) return Number.POSITIVE_INFINITY;
  return timeout ?? DEFAULT_STREAM_TIMEOUT_MS;
}

export const PROVIDER_CONCURRENCY_DEFAULTS = {
  max_concurrency: 0,
  queue_timeout_ms: 0,
  max_queue_size: 100,
} as const;

const PROVIDER_FIELDS = new Set([
  "name", "api_type", "base_url", "upstream_path", "api_key", "api_key_preview", "models", "is_active", "max_concurrency", "queue_timeout_ms", "max_queue_size", "adaptive_enabled", "proxy_type", "proxy_url", "proxy_username", "proxy_password",
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
    proxy_type?: string | null;
    proxy_url?: string | null;
    proxy_username?: string | null;
    proxy_password?: string | null;
  },
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, upstream_path, api_key, api_key_preview, models, is_active, max_concurrency, queue_timeout_ms, max_queue_size, adaptive_enabled, proxy_type, proxy_url, proxy_username, proxy_password, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    provider.proxy_type ?? null,
    provider.proxy_url ?? null,
    provider.proxy_username ?? null,
    provider.proxy_password ?? null,
    now, now,
  );
  return id;
}

export function updateProvider(
  db: Database.Database,
  id: string,
  fields: Partial<Pick<Provider, "name" | "api_type" | "base_url" | "upstream_path" | "api_key" | "api_key_preview" | "models" | "is_active" | "max_concurrency" | "queue_timeout_ms" | "max_queue_size" | "adaptive_enabled" | "proxy_type" | "proxy_url" | "proxy_username" | "proxy_password">>,
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

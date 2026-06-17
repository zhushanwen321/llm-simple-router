import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { buildUpdateQuery, deleteById } from "./helpers.js";
import { parseModels } from "../config/model-context.js";
import type { ProviderEndpoint } from "../core/types.js";

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
  /** @internal 原始 JSON 文本，业务层用 parseEndpoints() 解析 */
  endpoints?: string;
  created_at: string;
  updated_at: string;
}

/**
 * 默认流式超时 5 分钟。
 * 行为变更：v1.1.x 起从 600s(10min) 降为 300s(5min)，影响未显式配置 stream_timeout_ms 的 provider。
 * 长跑流式生成（长推理/长输出）若超 5min 会被中断，需在 provider/model 配置中显式调大或设 0(禁用)。
 */
export const DEFAULT_STREAM_TIMEOUT_MS = 300_000;

/** 默认非流式超时 10 分钟 */
export const DEFAULT_NON_STREAM_TIMEOUT_MS = 600_000;

/** 0 表示禁用超时（返回 Infinity）；undefined/null/未设置 使用默认值 */
function resolveTimeout(value: number | undefined, fallback: number): number {
  return value === 0 ? Number.POSITIVE_INFINITY : value ?? fallback;
}

/** 从 provider 的 models JSON 中查找指定模型的流式/非流式超时值。
 *  stream: entry.stream_timeout_ms ?? DEFAULT_STREAM_TIMEOUT_MS，0→Infinity
 *  nonStream: entry.non_stream_timeout_ms ?? DEFAULT_NON_STREAM_TIMEOUT_MS，0→Infinity */
export function getModelTimeouts(
  provider: Provider,
  backendModel: string,
): { stream: number; nonStream: number } {
  const entries = parseModels(provider.models);
  const entry = entries.find(m => m.name === backendModel);
  if (!entry) {
    return { stream: DEFAULT_STREAM_TIMEOUT_MS, nonStream: DEFAULT_NON_STREAM_TIMEOUT_MS };
  }
  return {
    stream: resolveTimeout(entry.stream_timeout_ms, DEFAULT_STREAM_TIMEOUT_MS),
    nonStream: resolveTimeout(entry.non_stream_timeout_ms, DEFAULT_NON_STREAM_TIMEOUT_MS),
  };
}

/** @deprecated 改用 getModelTimeouts。保留为薄包装以兼容现有调用方（iteration-setup 等）。 */
export function getModelStreamTimeout(
  provider: Provider,
  backendModel: string,
): number {
  return getModelTimeouts(provider, backendModel).stream;
}

export const PROVIDER_CONCURRENCY_DEFAULTS = {
  max_concurrency: 0,
  queue_timeout_ms: 0,
  max_queue_size: 100,
} as const;

const PROVIDER_FIELDS = new Set([
  "name", "api_type", "base_url", "upstream_path", "api_key", "api_key_preview", "models", "is_active", "max_concurrency", "queue_timeout_ms", "max_queue_size", "adaptive_enabled", "proxy_type", "proxy_url", "proxy_username", "proxy_password", "endpoints",
]);

const VALID_API_TYPES = new Set(["openai", "openai-responses", "anthropic"]);

/** 解析 endpoints JSON 文本为类型安全的数组 */
export function parseEndpoints(endpointsJson: string | null | undefined): ProviderEndpoint[] {
  if (!endpointsJson) return [];
  const parsed: unknown[] = JSON.parse(endpointsJson) as unknown[];
  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid endpoints JSON: not an array`);
  }
  // Validate every element is a non-null object with required fields
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Invalid endpoints JSON: element [${i}] is not an object`);
    }
    const obj = item as Record<string, unknown>;
    if (typeof obj.api_type !== "string" || !VALID_API_TYPES.has(obj.api_type)) {
      throw new Error(`Invalid endpoints JSON: element [${i}] has invalid api_type '${typeof obj.api_type === "string" ? obj.api_type : JSON.stringify(obj.api_type)}', must be one of: openai, openai-responses, anthropic`);
    }
    if (typeof obj.base_url !== "string" || obj.base_url.trim() === "") {
      throw new Error(`Invalid endpoints JSON: element [${i}] has invalid base_url, must be a non-empty string`);
    }
  }
  return parsed as ProviderEndpoint[];
}

/** 将 endpoints 数组序列化为 JSON 文本（用于 DB 写入） */
export function serializeEndpoints(endpoints: ProviderEndpoint[]): string {
  return JSON.stringify(endpoints);
}

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
    endpoints?: string;
  },
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, upstream_path, api_key, api_key_preview, models, is_active, max_concurrency, queue_timeout_ms, max_queue_size, adaptive_enabled, proxy_type, proxy_url, proxy_username, proxy_password, endpoints, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    provider.endpoints ?? null,
    now, now,
  );
  return id;
}

export function updateProvider(
  db: Database.Database,
  id: string,
  fields: Partial<Pick<Provider, "name" | "api_type" | "base_url" | "upstream_path" | "api_key" | "api_key_preview" | "models" | "is_active" | "max_concurrency" | "queue_timeout_ms" | "max_queue_size" | "adaptive_enabled" | "proxy_type" | "proxy_url" | "proxy_username" | "proxy_password" | "endpoints">>,
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

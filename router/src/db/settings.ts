import Database from "better-sqlite3";
import { getCachedStmt } from "./helpers.js";

// TTL 缓存：WeakMap 按 db 实例隔离，确保测试中 :memory: db 互不干扰
const settingsCache = new WeakMap<Database.Database, Map<string, { value: string | null; expiresAt: number }>>();
const CACHE_TTL_MS = 30_000;

export function getSetting(db: Database.Database, key: string): string | null {
  let cache = settingsCache.get(db);
  if (!cache) {
    cache = new Map();
    settingsCache.set(db, cache);
  }
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  const row = getCachedStmt(db, "SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  const value = row?.value ?? null;
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  getCachedStmt(db, "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
  const cache = settingsCache.get(db);
  if (cache) cache.delete(key);
}

export function isInitialized(db: Database.Database): boolean {
  return getSetting(db, "initialized") === "true";
}

export function getLogRetentionDays(db: Database.Database): number {
  const val = getSetting(db, "log_retention_days");
  const DEFAULT_LOG_RETENTION_DAYS = 3;
  return val ? parseInt(val, 10) : DEFAULT_LOG_RETENTION_DAYS;
}

export function setLogRetentionDays(db: Database.Database, days: number): void {
  setSetting(db, "log_retention_days", days.toString());
}

const DEFAULT_DB_MAX_SIZE_MB = 1024;
const DEFAULT_LOG_TABLE_MAX_SIZE_MB = 800;

export function getDbMaxSizeMb(db: Database.Database): number {
  const val = getSetting(db, "db_max_size_mb");
  return val ? parseInt(val, 10) : DEFAULT_DB_MAX_SIZE_MB;
}

export function setDbMaxSizeMb(db: Database.Database, mb: number): void {
  setSetting(db, "db_max_size_mb", mb.toString());
}

export function getLogTableMaxSizeMb(db: Database.Database): number {
  const val = getSetting(db, "log_table_max_size_mb");
  return val ? parseInt(val, 10) : DEFAULT_LOG_TABLE_MAX_SIZE_MB;
}

export function setLogTableMaxSizeMb(db: Database.Database, mb: number): void {
  setSetting(db, "log_table_max_size_mb", mb.toString());
}

export function getConfigSyncSource(db: Database.Database): "github" | "gitee" {
  const val = getSetting(db, "config_sync_source");
  return val === "gitee" ? "gitee" : "github";
}

export function setConfigSyncSource(db: Database.Database, source: "github" | "gitee"): void {
  setSetting(db, "config_sync_source", source);
}

export function getDetailLogEnabled(db: Database.Database): boolean {
  const row = getCachedStmt(db, "SELECT value FROM settings WHERE key = ?").get("detail_log_enabled") as { value: string } | undefined;
  return row ? row.value !== "0" : true;
}

export function getTokenEstimationEnabled(db: Database.Database): boolean {
  const val = getSetting(db, "token_estimation_enabled");
  return val === "true";
}

export function setTokenEstimationEnabled(db: Database.Database, enabled: boolean): void {
  setSetting(db, "token_estimation_enabled", enabled ? "true" : "false");
}

const DEFAULT_LOG_FILE_RETENTION_DAYS = 3;

export function getLogFileRetentionDays(db: Database.Database): number {
  const row = getCachedStmt(db, "SELECT value FROM settings WHERE key = ?").get("log_file_retention_days") as { value: string } | undefined;
  return row ? parseInt(row.value, 10) : DEFAULT_LOG_FILE_RETENTION_DAYS;
}

// ---------- Client Session Headers ----------

export interface ClientSessionHeaderEntry {
  client_type: string;
  session_header_key: string;
}

const DEFAULT_CLIENT_SESSION_HEADERS: ClientSessionHeaderEntry[] = [
  { client_type: "claude-code", session_header_key: "x-claude-code-session-id" },
  { client_type: "pi", session_header_key: "x-pi-session-id" },
];

export function getClientSessionHeaders(db: Database.Database): ClientSessionHeaderEntry[] {
  const val = getSetting(db, "client_session_headers");
  if (!val) return DEFAULT_CLIENT_SESSION_HEADERS;
  try {
    const parsed = JSON.parse(val);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_CLIENT_SESSION_HEADERS;
    return parsed;
  } catch {
    return DEFAULT_CLIENT_SESSION_HEADERS;
  }
}

export function setClientSessionHeaders(db: Database.Database, entries: ClientSessionHeaderEntry[]): void {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("entries must be a non-empty array");
  }
  setSetting(db, "client_session_headers", JSON.stringify(entries));
}

import Database from "better-sqlite3";
import { readFileSync, readdirSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS_DIR = join(__dirname, "migrations");

type CountRow = { count: number };
type AvgRow = { avg: number | null };

export function initDatabase(dbPath: string): Database.Database {
  // 自动创建目录（非内存数据库时）
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);

  // 确保 migrations 表存在
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (
      db.prepare("SELECT name FROM migrations").all() as {
        name: string;
      }[]
    ).map((r) => r.name)
  );

  // 读取目录下的 .sql 文件，按文件名排序
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    try {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
      db.exec(sql);
    } catch (err) {
      console.error(`Failed to apply migration ${file}:`, err);
      throw err;
    }
    db.prepare("INSERT INTO migrations (name, applied_at) VALUES (?, ?)").run(
      file,
      new Date().toISOString()
    );
  }

  return db;
}

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

export interface ModelMapping {
  id: string;
  client_model: string;
  backend_model: string;
  provider_id: string;
  is_active: number;
  created_at: string;
}

export function getActiveProviders(
  db: Database.Database,
  apiType: "openai" | "anthropic"
): Provider[] {
  return db
    .prepare(
      "SELECT * FROM providers WHERE api_type = ? AND is_active = 1"
    )
    .all(apiType) as Provider[];
}

export function getModelMapping(
  db: Database.Database,
  clientModel: string
): ModelMapping | undefined {
  return db
    .prepare(
      "SELECT * FROM model_mappings WHERE client_model = ? AND is_active = 1"
    )
    .get(clientModel) as ModelMapping | undefined;
}

export function insertRequestLog(db: Database.Database, log: {
  id: string; api_type: string; model: string | null; provider_id: string | null;
  status_code: number | null; latency_ms: number | null; is_stream: number; error_message: string | null;
  created_at: string;
  request_body?: string | null; response_body?: string | null;
  client_request?: string | null; upstream_request?: string | null;
  upstream_response?: string | null; client_response?: string | null;
  is_retry?: number; original_request_id?: string | null;
}): void {
  db.prepare(
    `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, error_message, created_at, request_body, response_body, client_request, upstream_request, upstream_response, client_response, is_retry, original_request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(log.id, log.api_type, log.model, log.provider_id, log.status_code, log.latency_ms, log.is_stream,
    log.error_message, log.created_at, log.request_body ?? null, log.response_body ?? null,
    log.client_request ?? null, log.upstream_request ?? null, log.upstream_response ?? null, log.client_response ?? null,
    log.is_retry ?? 0, log.original_request_id ?? null);
}

// --- Admin CRUD ---

export interface RequestLog {
  id: string;
  api_type: string;
  model: string | null;
  provider_id: string | null;
  status_code: number | null;
  latency_ms: number | null;
  is_stream: number;
  error_message: string | null;
  created_at: string;
  request_body: string | null;
  response_body: string | null;
  client_request: string | null;
  upstream_request: string | null;
  upstream_response: string | null;
  client_response: string | null;
  is_retry: number;
  original_request_id: string | null;
}

export interface Stats {
  totalRequests: number;
  successRate: number;
  avgLatency: number;
  requestsByType: Record<string, number>;
  recentRequests: number;
}

export interface MetricsRow {
  id: string;
  request_log_id: string;
  provider_id: string;
  backend_model: string;
  api_type: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
  ttft_ms: number | null;
  total_duration_ms: number | null;
  tokens_per_second: number | null;
  stop_reason: string | null;
  is_complete: number;
  created_at: string;
}

export type MetricsInsert = {
  request_log_id: string;
  provider_id: string;
  backend_model: string;
  api_type: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_tokens?: number | null;
  cache_read_tokens?: number | null;
  ttft_ms?: number | null;
  total_duration_ms?: number | null;
  tokens_per_second?: number | null;
  stop_reason?: string | null;
  is_complete?: number;
};

export function insertMetrics(db: Database.Database, m: MetricsInsert): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO request_metrics (id, request_log_id, provider_id, backend_model, api_type, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, ttft_ms, total_duration_ms, tokens_per_second, stop_reason, is_complete)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, m.request_log_id, m.provider_id, m.backend_model, m.api_type,
    m.input_tokens ?? null, m.output_tokens ?? null, m.cache_creation_tokens ?? null, m.cache_read_tokens ?? null,
    m.ttft_ms ?? null, m.total_duration_ms ?? null, m.tokens_per_second ?? null, m.stop_reason ?? null, m.is_complete ?? 1);
  return id;
}

export function getAllProviders(db: Database.Database): Provider[] {
  return db.prepare("SELECT * FROM providers ORDER BY created_at DESC").all() as Provider[];
}

export function getProviderById(db: Database.Database, id: string): Provider | undefined {
  return db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as Provider | undefined;
}

export function createProvider(
  db: Database.Database,
  provider: { name: string; api_type: "openai" | "anthropic"; base_url: string; api_key: string; api_key_preview?: string; is_active?: number }
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, api_key, api_key_preview, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, provider.name, provider.api_type, provider.base_url, provider.api_key, provider.api_key_preview ?? null, provider.is_active ?? 1, now, now);
  return id;
}

export function updateProvider(db: Database.Database, id: string, fields: Partial<Pick<Provider, 'name' | 'api_type' | 'base_url' | 'api_key' | 'api_key_preview' | 'is_active'>>): void {
  const ALLOWED = new Set(['name', 'api_type', 'base_url', 'api_key', 'api_key_preview', 'is_active']);
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED.has(key)) continue;
    sets.push(`${key} = ?`);
    values.push(value);
  }
  sets.push("updated_at = ?");
  values.push(new Date().toISOString(), id);
  db.prepare(`UPDATE providers SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteProvider(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM providers WHERE id = ?").run(id);
}

export function getAllModelMappings(db: Database.Database): ModelMapping[] {
  return db.prepare("SELECT * FROM model_mappings ORDER BY created_at DESC").all() as ModelMapping[];
}

export function createModelMapping(
  db: Database.Database,
  mapping: { client_model: string; backend_model: string; provider_id: string; is_active?: number }
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO model_mappings (id, client_model, backend_model, provider_id, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, mapping.client_model, mapping.backend_model, mapping.provider_id, mapping.is_active ?? 1, now);
  return id;
}

export function updateModelMapping(db: Database.Database, id: string, fields: Partial<Pick<ModelMapping, 'client_model' | 'backend_model' | 'provider_id' | 'is_active'>>): void {
  const ALLOWED = new Set(['client_model', 'backend_model', 'provider_id', 'is_active']);
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED.has(key)) continue;
    sets.push(`${key} = ?`);
    values.push(value);
  }
  values.push(id);
  db.prepare(`UPDATE model_mappings SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteModelMapping(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM model_mappings WHERE id = ?").run(id);
}

export function getRequestLogs(db: Database.Database, options: { page: number; limit: number; api_type?: string; model?: string }): { data: RequestLog[]; total: number } {
  let where = "1=1";
  const params: unknown[] = [];
  if (options.api_type) { where += " AND api_type = ?"; params.push(options.api_type); }
  if (options.model) { where += " AND model LIKE ?"; params.push(`%${options.model}%`); }
  const total = (db.prepare(`SELECT COUNT(*) as count FROM request_logs WHERE ${where}`).get(...params) as CountRow).count;
  const offset = (options.page - 1) * options.limit;
  const data = db.prepare(`SELECT * FROM request_logs WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, options.limit, offset) as RequestLog[];
  return { data, total };
}

export function getRequestLogById(db: Database.Database, id: string): RequestLog | undefined {
  return db.prepare("SELECT * FROM request_logs WHERE id = ?").get(id) as RequestLog | undefined;
}

export function deleteLogsBefore(db: Database.Database, beforeDate: string): number {
  return db.prepare("DELETE FROM request_logs WHERE created_at < ?").run(beforeDate).changes;
}

// --- Metrics (re-export from metrics.ts) ---

export { getMetricsSummary, getMetricsTimeseries } from "./metrics.js";
export type { MetricsSummaryRow, MetricsTimeseriesRow, MetricsPeriod, MetricsMetric } from "./metrics.js";

export function getStats(db: Database.Database): Stats {
  const total = (db.prepare("SELECT COUNT(*) as count FROM request_logs").get() as CountRow).count;
  const successCount = (db.prepare("SELECT COUNT(*) as count FROM request_logs WHERE status_code >= 200 AND status_code < 300").get() as CountRow).count;
  const avgResult = db.prepare("SELECT AVG(latency_ms) as avg FROM request_logs WHERE latency_ms IS NOT NULL").get() as AvgRow;
  const recentCount = (db.prepare("SELECT COUNT(*) as count FROM request_logs WHERE created_at >= datetime('now', '-1 day')").get() as CountRow).count;
  const requestsByType: Record<string, number> = {};
  for (const row of db.prepare("SELECT api_type, COUNT(*) as count FROM request_logs GROUP BY api_type").all() as { api_type: string; count: number }[]) {
    requestsByType[row.api_type] = row.count;
  }
  return { totalRequests: total, successRate: total > 0 ? successCount / total : 0, avgLatency: avgResult?.avg ?? 0, requestsByType, recentRequests: recentCount };
}

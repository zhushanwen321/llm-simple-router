import Database from "better-sqlite3";
import { readFileSync, readdirSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS_DIR = join(__dirname, "migrations");

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

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    db.exec(sql);
    db.prepare("INSERT INTO migrations (name, applied_at) VALUES (?, ?)").run(
      file,
      new Date().toISOString()
    );
  }

  return db;
}

export interface BackendService {
  id: string;
  name: string;
  api_type: "openai" | "anthropic";
  base_url: string;
  api_key: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ModelMapping {
  id: string;
  client_model: string;
  backend_model: string;
  backend_service_id: string;
  is_active: number;
  created_at: string;
}

export function getActiveBackendServices(
  db: Database.Database,
  apiType: "openai" | "anthropic"
): BackendService[] {
  return db
    .prepare(
      "SELECT * FROM backend_services WHERE api_type = ? AND is_active = 1"
    )
    .all(apiType) as BackendService[];
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

export function insertRequestLog(
  db: Database.Database,
  log: {
    id: string;
    api_type: string;
    model: string | null;
    backend_service_id: string | null;
    status_code: number | null;
    latency_ms: number | null;
    is_stream: number;
    error_message: string | null;
    created_at: string;
    request_body?: string | null;
    response_body?: string | null;
    client_request?: string | null;
    upstream_request?: string | null;
    upstream_response?: string | null;
    client_response?: string | null;
  }
): void {
  db.prepare(
    `INSERT INTO request_logs (id, api_type, model, backend_service_id, status_code, latency_ms, is_stream, error_message, created_at, request_body, response_body, client_request, upstream_request, upstream_response, client_response)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    log.id,
    log.api_type,
    log.model,
    log.backend_service_id,
    log.status_code,
    log.latency_ms,
    log.is_stream,
    log.error_message,
    log.created_at,
    log.request_body ?? null,
    log.response_body ?? null,
    log.client_request ?? null,
    log.upstream_request ?? null,
    log.upstream_response ?? null,
    log.client_response ?? null
  );
}

// --- Admin CRUD ---

export interface RequestLog {
  id: string;
  api_type: string;
  model: string | null;
  backend_service_id: string | null;
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
}

export interface Stats {
  totalRequests: number;
  successRate: number;
  avgLatency: number;
  requestsByType: Record<string, number>;
  recentRequests: number;
}

export function getAllBackendServices(db: Database.Database): BackendService[] {
  return db.prepare("SELECT * FROM backend_services ORDER BY created_at DESC").all() as BackendService[];
}

export function getBackendServiceById(db: Database.Database, id: string): BackendService | undefined {
  return db.prepare("SELECT * FROM backend_services WHERE id = ?").get(id) as BackendService | undefined;
}

export function createBackendService(
  db: Database.Database,
  service: { name: string; api_type: "openai" | "anthropic"; base_url: string; api_key: string; is_active?: number }
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, service.name, service.api_type, service.base_url, service.api_key, service.is_active ?? 1, now, now);
  return id;
}

export function updateBackendService(
  db: Database.Database,
  id: string,
  fields: Partial<Pick<BackendService, 'name' | 'api_type' | 'base_url' | 'api_key' | 'is_active'>>
): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = ?`);
    values.push(value);
  }
  sets.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);
  db.prepare(`UPDATE backend_services SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteBackendService(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM backend_services WHERE id = ?").run(id);
}

export function getAllModelMappings(db: Database.Database): ModelMapping[] {
  return db.prepare("SELECT * FROM model_mappings ORDER BY created_at DESC").all() as ModelMapping[];
}

export function createModelMapping(
  db: Database.Database,
  mapping: { client_model: string; backend_model: string; backend_service_id: string; is_active?: number }
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO model_mappings (id, client_model, backend_model, backend_service_id, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, mapping.client_model, mapping.backend_model, mapping.backend_service_id, mapping.is_active ?? 1, now);
  return id;
}

export function updateModelMapping(
  db: Database.Database,
  id: string,
  fields: Partial<Pick<ModelMapping, 'client_model' | 'backend_model' | 'backend_service_id' | 'is_active'>>
): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = ?`);
    values.push(value);
  }
  values.push(id);
  db.prepare(`UPDATE model_mappings SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteModelMapping(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM model_mappings WHERE id = ?").run(id);
}

export function getRequestLogs(
  db: Database.Database,
  options: { page: number; limit: number; api_type?: string; model?: string }
): { data: RequestLog[]; total: number } {
  let where = "1=1";
  const params: unknown[] = [];
  if (options.api_type) { where += " AND api_type = ?"; params.push(options.api_type); }
  if (options.model) { where += " AND model LIKE ?"; params.push(`%${options.model}%`); }

  const total = (db.prepare(`SELECT COUNT(*) as count FROM request_logs WHERE ${where}`).get(...params) as { count: number }).count;
  const offset = (options.page - 1) * options.limit;
  const data = db.prepare(
    `SELECT * FROM request_logs WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, options.limit, offset) as RequestLog[];
  return { data, total };
}

export function getRequestLogById(
  db: Database.Database,
  id: string
): RequestLog | undefined {
  return db.prepare("SELECT * FROM request_logs WHERE id = ?").get(id) as RequestLog | undefined;
}

export function deleteLogsBefore(db: Database.Database, beforeDate: string): number {
  const result = db.prepare("DELETE FROM request_logs WHERE created_at < ?").run(beforeDate);
  return result.changes;
}

export function getStats(db: Database.Database): Stats {
  const total = (db.prepare("SELECT COUNT(*) as count FROM request_logs").get() as { count: number }).count;
  const successCount = (db.prepare(
    "SELECT COUNT(*) as count FROM request_logs WHERE status_code >= 200 AND status_code < 300"
  ).get() as { count: number }).count;
  const avgResult = db.prepare("SELECT AVG(latency_ms) as avg FROM request_logs WHERE latency_ms IS NOT NULL").get() as { avg: number | null };
  const recentCount = (db.prepare(
    "SELECT COUNT(*) as count FROM request_logs WHERE created_at >= datetime('now', '-1 day')"
  ).get() as { count: number }).count;

  const typeRows = db.prepare("SELECT api_type, COUNT(*) as count FROM request_logs GROUP BY api_type").all() as { api_type: string; count: number }[];
  const requestsByType: Record<string, number> = {};
  for (const row of typeRows) { requestsByType[row.api_type] = row.count; }

  return {
    totalRequests: total,
    successRate: total > 0 ? successCount / total : 0,
    avgLatency: avgResult?.avg ?? 0,
    requestsByType,
    recentRequests: recentCount,
  };
}

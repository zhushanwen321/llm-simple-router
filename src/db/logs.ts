import Database from "better-sqlite3";
import { randomUUID } from "crypto";

type CountRow = { count: number };

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

// --- request_logs ---

export function insertRequestLog(
  db: Database.Database,
  log: {
    id: string;
    api_type: string;
    model: string | null;
    provider_id: string | null;
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
    is_retry?: number;
    original_request_id?: string | null;
    router_key_id?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, error_message, created_at, request_body, response_body, client_request, upstream_request, upstream_response, client_response, is_retry, original_request_id, router_key_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    log.id, log.api_type, log.model, log.provider_id, log.status_code,
    log.latency_ms, log.is_stream, log.error_message, log.created_at,
    log.request_body ?? null, log.response_body ?? null,
    log.client_request ?? null, log.upstream_request ?? null,
    log.upstream_response ?? null, log.client_response ?? null,
    log.is_retry ?? 0, log.original_request_id ?? null, log.router_key_id ?? null,
  );
}

export function getRequestLogs(
  db: Database.Database,
  options: {
    page: number;
    limit: number;
    api_type?: string;
    model?: string;
    router_key_id?: string;
  },
): { data: RequestLog[]; total: number } {
  let where = "1=1";
  const params: unknown[] = [];
  if (options.api_type) {
    where += " AND api_type = ?";
    params.push(options.api_type);
  }
  if (options.model) {
    where += " AND model LIKE ?";
    params.push(`%${options.model}%`);
  }
  if (options.router_key_id) {
    where += " AND router_key_id = ?";
    params.push(options.router_key_id);
  }
  const total = (
    db.prepare(`SELECT COUNT(*) as count FROM request_logs WHERE ${where}`).get(...params) as CountRow
  ).count;
  const offset = (options.page - 1) * options.limit;
  const data = db
    .prepare(
      `SELECT id, api_type, model, provider_id, status_code, latency_ms, is_stream, error_message, created_at, is_retry, original_request_id
       FROM request_logs WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, options.limit, offset) as RequestLog[];
  return { data, total };
}

export function getRequestLogById(db: Database.Database, id: string): RequestLog | undefined {
  return db.prepare("SELECT * FROM request_logs WHERE id = ?").get(id) as RequestLog | undefined;
}

export function deleteLogsBefore(db: Database.Database, beforeDate: string): number {
  return db.prepare("DELETE FROM request_logs WHERE created_at < ?").run(beforeDate).changes;
}

// --- request_metrics ---

export function insertMetrics(db: Database.Database, m: MetricsInsert): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO request_metrics (id, request_log_id, provider_id, backend_model, api_type, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, ttft_ms, total_duration_ms, tokens_per_second, stop_reason, is_complete)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, m.request_log_id, m.provider_id, m.backend_model, m.api_type,
    m.input_tokens ?? null, m.output_tokens ?? null,
    m.cache_creation_tokens ?? null, m.cache_read_tokens ?? null,
    m.ttft_ms ?? null, m.total_duration_ms ?? null,
    m.tokens_per_second ?? null, m.stop_reason ?? null, m.is_complete ?? 1,
  );
  return id;
}

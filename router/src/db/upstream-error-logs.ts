import Database from "better-sqlite3";
import { randomUUID } from "crypto";

export interface UpstreamErrorLog {
  id: string;
  request_log_id: string | null;
  provider_id: string;
  backend_model: string;
  status_code: number;
  error_type: string | null;
  error_message: string | null;
  client_agent_type: string;
  router_key_id: string | null;
  session_id: string | null;
  retry_count: number;
  created_at: string;
}

/** 写入单条上游错误记录 */
export function logUpstreamError(
  db: Database.Database,
  entry: Omit<UpstreamErrorLog, "id" | "created_at">,
): void {
  db.prepare(`
    INSERT INTO upstream_error_logs
      (id, request_log_id, provider_id, backend_model, status_code,
       error_type, error_message, client_agent_type, router_key_id,
       session_id, retry_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    entry.request_log_id,
    entry.provider_id,
    entry.backend_model,
    entry.status_code,
    entry.error_type,
    entry.error_message,
    entry.client_agent_type,
    entry.router_key_id,
    entry.session_id,
    entry.retry_count,
    new Date().toISOString(),
  );
}

/**
 * 从上游响应体提取错误信息。
 * 优先 error.type，其次 error.code 作为 errorType；
 * error.message 作为 errorMessage。
 * JSON.parse 失败返回 null。
 */
export function extractErrorInfo(body: string): { errorType: string | null; errorMessage: string | null } {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const error = parsed.error as Record<string, unknown> | undefined;
    if (error && typeof error === "object") {
      const errorType = typeof error.type === "string"
        ? error.type
        : typeof error.code === "string"
          ? error.code
          : null;
      const errorMessage = typeof error.message === "string" ? error.message : null;
      return { errorType, errorMessage };
    }
    return { errorType: null, errorMessage: null };
  } catch {
    return { errorType: null, errorMessage: null };
  }
}

/** 清理过期记录，返回删除行数 */
export function cleanUpstreamErrorLogs(db: Database.Database, beforeDate: string): number {
  return db.prepare("DELETE FROM upstream_error_logs WHERE created_at < ?").run(beforeDate).changes;
}

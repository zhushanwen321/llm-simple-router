import Database from "better-sqlite3";
import type { LogFileWriter } from "../storage/log-file-writer.js";
import { shouldPreserveDetail, type RetryMatcher } from "../proxy/log-detail-policy.js";
import { getCachedStmt } from "./helpers.js";

type CountRow = { count: number };

export interface RequestLog {
  id: string;
  api_type: string;
  model: string | null;
  provider_id: string | null;
  status_code: number | null;
  client_status_code: number | null;
  latency_ms: number | null;
  is_stream: number;
  error_message: string | null;
  created_at: string;
  client_request: string | null;
  upstream_request: string | null;
  upstream_response: string | null;
  is_retry: number;
  is_failover: number;
  original_request_id: string | null;
  original_model: string | null;
  stream_text_content: string | null;
  session_id: string | null;
}

/** 列表查询扩展字段：JOIN providers 获得 provider_name */
export interface RequestLogListRow extends RequestLog {
  provider_name: string | null;
  child_count?: number;
}

// --- request_logs ---

const LOG_LIST_SELECT = `rl.id, rl.api_type, rl.model, rl.provider_id, rl.status_code, rl.client_status_code, rl.latency_ms,
            rl.is_stream, rl.error_message, rl.created_at, rl.is_retry, rl.is_failover, rl.original_request_id, rl.original_model,
            CASE WHEN rl.provider_id = 'router' THEN rl.upstream_request ELSE NULL END AS upstream_request,
            rl.session_id, rl.pipeline_snapshot,
            rm.input_tokens, rm.output_tokens, rm.cache_read_tokens, rm.ttft_ms,
            rm.tokens_per_second, rm.stop_reason, rm.backend_model, rm.is_complete AS metrics_complete,
            rm.input_tokens_estimated, rm.client_type, rm.cache_read_tokens_estimated,
            COALESCE(p.name, rl.provider_id) AS provider_name`;
const LOG_LIST_JOIN = `LEFT JOIN providers p ON p.id = rl.provider_id LEFT JOIN request_metrics rm ON rm.request_log_id = rl.id`;

export interface RequestLogInsert {
  id: string;
  api_type: string;
  model: string | null;
  provider_id: string | null;
  status_code: number | null;
  latency_ms: number | null;
  is_stream: number;
  error_message: string | null;
  created_at: string;
  client_request?: string | null;
  upstream_request?: string | null;
  upstream_response?: string | null;
  is_retry?: number;
  is_failover?: number;
  original_request_id?: string | null;
  router_key_id?: string | null;
  original_model?: string | null;
  session_id?: string | null;
  client_status_code?: number | null;
  pipeline_snapshot?: string | null;
}

export interface LogWriteContext {
  matcher?: RetryMatcher | null;
  logFileWriter?: LogFileWriter | null;
  responseBody?: string | null;
}

export function insertRequestLog(
  db: Database.Database,
  log: RequestLogInsert,
  writeContext?: LogWriteContext,
): void {
  // 文件写入：始终写入全文
  if (writeContext?.logFileWriter) {
    writeContext.logFileWriter.write({
      id: log.id,
      created_at: log.created_at,
      api_type: log.api_type,
      status_code: log.status_code,
      client_request: log.client_request ?? null,
      upstream_request: log.upstream_request ?? null,
      upstream_response: log.upstream_response ?? null,
      stream_text_content: null,
      pipeline_snapshot: log.pipeline_snapshot ?? null,
    });
  }

  // 详情保留判定
  const preserveDetail = shouldPreserveDetail(
    log.status_code, writeContext?.responseBody ?? null, writeContext?.matcher ?? null,
    !!writeContext?.logFileWriter,
  );

  getCachedStmt(
    db,
    `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, client_status_code, latency_ms,
      is_stream, error_message, created_at, client_request, upstream_request, upstream_response,
      is_retry, is_failover, original_request_id, router_key_id, original_model, session_id, pipeline_snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    log.id, log.api_type, log.model, log.provider_id, log.status_code,
    log.client_status_code ?? null,
    log.latency_ms, log.is_stream, log.error_message, log.created_at,
    preserveDetail ? (log.client_request ?? null) : null,
    preserveDetail ? (log.upstream_request ?? null) : null,
    preserveDetail ? (log.upstream_response ?? null) : null,
    log.is_retry ?? 0, log.is_failover ?? 0, log.original_request_id ?? null,
    log.router_key_id ?? null, log.original_model ?? null,
    log.session_id ?? null,
    log.pipeline_snapshot ?? null,
  );
}

type LogFilterOptions = {
  api_type?: string;
  model?: string;
  router_key_id?: string;
  provider_id?: string;
  start_time?: string;
  end_time?: string;
  status_code?: string;
};

function buildLogWhereClause(
  options: LogFilterOptions,
  baseCondition: string,
): { where: string; params: unknown[] } {
  let where = baseCondition;
  const params: unknown[] = [];
  if (options.api_type) {
    where += " AND rl.api_type = ?";
    params.push(options.api_type);
  }
  if (options.model) {
    where += " AND rl.model LIKE ?";
    params.push(`%${options.model}%`);
  }
  if (options.router_key_id) {
    where += " AND rl.router_key_id = ?";
    params.push(options.router_key_id);
  }
  if (options.provider_id) {
    where += " AND rl.provider_id = ?";
    params.push(options.provider_id);
  }
  if (options.start_time) {
    where += " AND rl.created_at >= ?";
    params.push(options.start_time);
  }
  if (options.end_time) {
    where += " AND rl.created_at <= ?";
    params.push(options.end_time);
  }
  if (options.status_code) {
    if (options.status_code === "200") {
      where += " AND rl.status_code = 200";
    } else if (options.status_code === "non200") {
      where += " AND (rl.status_code IS NULL OR rl.status_code != 200)";
    }
  }
  return { where, params };
}

export function getRequestLogs(
  db: Database.Database,
  options: {
    page: number;
    limit: number;
    api_type?: string;
    model?: string;
    router_key_id?: string;
    provider_id?: string;
    start_time?: string;
    end_time?: string;
  },
): { data: RequestLogListRow[]; total: number } {
  const { where, params } = buildLogWhereClause(options, "1=1");
  const total = (
    db.prepare(`SELECT COUNT(*) as count FROM request_logs rl WHERE ${where}`).get(...params) as CountRow
  ).count;
  const offset = (options.page - 1) * options.limit;
  const data = db
    .prepare(
      `SELECT ${LOG_LIST_SELECT}
       FROM request_logs rl
       ${LOG_LIST_JOIN}
       WHERE ${where} ORDER BY rl.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, options.limit, offset) as RequestLogListRow[];
  return { data, total };
}

export function getRequestLogById(db: Database.Database, id: string): RequestLogListRow | undefined {
  return db.prepare(
    `SELECT rl.*, rm.input_tokens, rm.output_tokens, rm.cache_read_tokens, rm.ttft_ms,
            rm.tokens_per_second, rm.stop_reason, rm.backend_model, rm.is_complete AS metrics_complete,
            rm.input_tokens_estimated, rm.client_type, rm.cache_read_tokens_estimated,
            COALESCE(p.name, rl.provider_id) AS provider_name
     FROM request_logs rl
     LEFT JOIN providers p ON p.id = rl.provider_id
     LEFT JOIN request_metrics rm ON rm.request_log_id = rl.id
     WHERE rl.id = ?`,
  ).get(id) as RequestLogListRow | undefined;
}



/** 流式请求完成后，将 tracker 中累积的文本内容写入 request_logs */
export function updateLogStreamContent(db: Database.Database, logId: string, textContent: string): void {
  getCachedStmt(db, "UPDATE request_logs SET stream_text_content = ? WHERE id = ?").run(textContent, logId);
}

/** 当 router 返回给客户端的 status code 与上游不同时，记录实际发送的 status */
export function updateLogClientStatus(db: Database.Database, logId: string, clientStatusCode: number): void {
  getCachedStmt(db, "UPDATE request_logs SET client_status_code = ? WHERE id = ?").run(clientStatusCode, logId);
}



export function deleteLogsBefore(db: Database.Database, beforeDate: string): number {
  const changes = db.prepare("DELETE FROM request_logs WHERE created_at < ?").run(beforeDate).changes;
  if (changes > 0) {
    db.pragma("incremental_vacuum");
  }
  return changes;
}

/** 每行元数据（数字列+索引）的估算字节数 */
const ROW_METADATA_BYTES = 500;

/** 采样估算 request_logs 表占用字节数（避免全表 SUM 扫描） */
export function estimateLogTableSize(db: Database.Database): number {
  const countRow = db.prepare("SELECT COUNT(*) as cnt FROM request_logs").get() as { cnt: number };
  if (countRow.cnt === 0) return 0;

  // 采样最近 100 行，计算平均行大小
  const samples = db.prepare(`
    SELECT COALESCE(length(client_request), 0) + COALESCE(length(upstream_request), 0) +
           COALESCE(length(upstream_response), 0) + COALESCE(length(stream_text_content), 0) +
           COALESCE(length(error_message), 0) + COALESCE(length(pipeline_snapshot), 0) + ? AS row_size
    FROM request_logs ORDER BY created_at DESC LIMIT 100
  `).all(ROW_METADATA_BYTES) as { row_size: number }[];

  const avgRowSize = samples.reduce((s, r) => s + r.row_size, 0) / samples.length;
  return Math.round(avgRowSize * countRow.cnt);
}

const DELETE_BATCH_SIZE = 1000;

/** 删除最旧的日志，保留 keepCount 条，返回实际删除条数。分批删除避免长时间锁表 */
export function deleteOldestLogs(db: Database.Database, keepCount: number): number {
  const total = (db.prepare("SELECT count(*) as c FROM request_logs").get() as { c: number }).c;
  const toDelete = Math.max(0, total - keepCount);
  if (toDelete === 0) return 0;

  let totalDeleted = 0;
  const stmt = db.prepare(`
    DELETE FROM request_logs
    WHERE rowid IN (
      SELECT rowid FROM request_logs ORDER BY created_at ASC LIMIT ?
    )
  `);

  while (totalDeleted < toDelete) {
    const batchSize = Math.min(DELETE_BATCH_SIZE, toDelete - totalDeleted);
    const result = stmt.run(batchSize);
    totalDeleted += result.changes;
    if (result.changes < batchSize) break;
  }

  if (totalDeleted > 0) {
    db.pragma("incremental_vacuum");
  }
  return totalDeleted;
}

/** 获取 request_logs 总行数 */
export function getLogCount(db: Database.Database): number {
  return (db.prepare("SELECT count(*) as c FROM request_logs").get() as { c: number }).c;
}

/** 查询某条日志的子请求（retry/failover 关联），上限 100 条 */
export function getRequestLogChildren(
  db: Database.Database,
  parentId: string,
): RequestLogListRow[] {
  return db.prepare(
    `SELECT ${LOG_LIST_SELECT}
     FROM request_logs rl
     ${LOG_LIST_JOIN}
     WHERE rl.original_request_id = ?
     ORDER BY rl.created_at ASC
     LIMIT 100`,
  ).all(parentId) as RequestLogListRow[];
}

export interface RequestLogGroupedRow extends RequestLogListRow {
  child_count: number;
}

/** 只返回根请求（original_request_id IS NULL），附带子请求数量 */
export function getRequestLogsGrouped(
  db: Database.Database,
  options: {
    page: number;
    limit: number;
    api_type?: string;
    model?: string;
    router_key_id?: string;
    provider_id?: string;
    start_time?: string;
    end_time?: string;
  },
): { data: RequestLogGroupedRow[]; total: number } {
  const { where, params } = buildLogWhereClause(options, "rl.original_request_id IS NULL");
  const total = (
    db.prepare(`SELECT COUNT(*) as count FROM request_logs rl WHERE ${where}`).get(...params) as CountRow
  ).count;
  const offset = (options.page - 1) * options.limit;
  const data = db
    .prepare(
      `WITH page_ids AS (
         SELECT rl.id FROM request_logs rl
         ${LOG_LIST_JOIN}
         WHERE ${where}
         ORDER BY rl.created_at DESC LIMIT ? OFFSET ?
       )
       SELECT ${LOG_LIST_SELECT},
              COALESCE(child.cnt, 0) AS child_count
       FROM page_ids pg
       JOIN request_logs rl ON rl.id = pg.id
       ${LOG_LIST_JOIN}
       LEFT JOIN (
         SELECT original_request_id, COUNT(*) AS cnt
         FROM request_logs
         WHERE original_request_id IN (SELECT id FROM page_ids)
         GROUP BY original_request_id
       ) child ON child.original_request_id = rl.id
       ORDER BY rl.created_at DESC`,
    )
    .all(...params, options.limit, offset) as RequestLogGroupedRow[];
  return { data, total };
}

/** 后续 pipeline 阶段完成后，回写 snapshot 到已有日志 */
export function updateLogPipelineSnapshot(db: Database.Database, logId: string, snapshot: string): void {
  getCachedStmt(db, "UPDATE request_logs SET pipeline_snapshot = ? WHERE id = ?").run(snapshot, logId);
}

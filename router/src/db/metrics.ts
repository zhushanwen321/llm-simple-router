import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { MS_PER_SECOND } from "../core/constants.js";
import { getCachedStmt } from "./helpers.js";
import { toSqliteDatetime } from "../utils/datetime.js";
import { queryAggSummary, queryAggTimeseries } from "./metrics-10min.js";

export type MetricsPeriod = "1h" | "5h" | "6h" | "24h" | "7d" | "30d";
export type MetricsMetric = "ttft" | "tps" | "text_tps" | "thinking_tps" | "tool_use_tps" | "non_thinking_tps" | "total_tps" | "tokens" | "cache_rate" | "request_count" | "input_tokens" | "output_tokens" | "cache_hit_tokens";

// --- request_metrics table types & CRUD ---

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
  client_type: string;
  cache_read_tokens_estimated: number;
  created_at: string;
}

export type MetricsInsert = {
  request_log_id: string;
  provider_id: string;
  backend_model: string;
  api_type: string;
  router_key_id?: string | null;
  status_code?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_tokens?: number | null;
  cache_read_tokens?: number | null;
  ttft_ms?: number | null;
  total_duration_ms?: number | null;
  tokens_per_second?: number | null;
  stop_reason?: string | null;
  is_complete?: number;
  input_tokens_estimated?: number;
  client_type?: string;
  cache_read_tokens_estimated?: number;
  // TPS breakdown
  thinking_tokens?: number | null;
  text_tokens?: number | null;
  tool_use_tokens?: number | null;
  thinking_duration_ms?: number | null;
  non_thinking_duration_ms?: number | null;
  thinking_tps?: number | null;
  non_thinking_tps?: number | null;
  total_tps?: number | null;
};

/** DB INSERT 逻辑 */
function rawInsertMetrics(db: Database.Database, m: MetricsInsert & { id: string }): void {
  getCachedStmt(
    db,
    `INSERT INTO request_metrics (id, request_log_id, provider_id, backend_model, api_type, router_key_id, status_code,
       input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, ttft_ms, total_duration_ms, tokens_per_second, stop_reason, is_complete, input_tokens_estimated,
       client_type, cache_read_tokens_estimated,
       thinking_tokens, text_tokens, tool_use_tokens, thinking_duration_ms,
       thinking_tps, total_tps, non_thinking_duration_ms, non_thinking_tps)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    m.id, m.request_log_id, m.provider_id, m.backend_model, m.api_type,
    m.router_key_id ?? null, m.status_code ?? null,
    m.input_tokens ?? null, m.output_tokens ?? null,
    m.cache_creation_tokens ?? null, m.cache_read_tokens ?? null,
    m.ttft_ms ?? null, m.total_duration_ms ?? null,
    m.tokens_per_second ?? null, m.stop_reason ?? null, m.is_complete ?? 1,
    m.input_tokens_estimated ?? 0,
    m.client_type ?? 'unknown', m.cache_read_tokens_estimated ?? 0,
    m.thinking_tokens ?? null, m.text_tokens ?? null, m.tool_use_tokens ?? null,
    m.thinking_duration_ms ?? null,
    m.thinking_tps ?? null, m.total_tps ?? null,
    m.non_thinking_duration_ms ?? null, m.non_thinking_tps ?? null,
  );
}

export function insertMetrics(db: Database.Database, m: MetricsInsert): string {
  const id = randomUUID();
  rawInsertMetrics(db, { ...m, id });
  return id;
}

const PERIOD_OFFSET: Record<MetricsPeriod, string> = {
  "1h": "-1 hours",
  "5h": "-5 hours",
  "6h": "-6 hours",
  "24h": "-1 day",
  "7d": "-7 days",
  "30d": "-30 days",
};

// 精确 DATA_POINT_COUNT 个数据点：总秒数 / DATA_POINT_COUNT，最小 MIN_BUCKET_SEC 秒避免过细
const MIN_BUCKET_SEC = 60;
const DATA_POINT_COUNT = 10;
const PERCENT = 100;

function calcBucketSec(totalSec: number): number {
  return Math.max(MIN_BUCKET_SEC, Math.round(totalSec / DATA_POINT_COUNT));
}

export interface MetricsSummaryRow {
  provider_id: string;
  provider_name: string;
  backend_model: string;
  client_type: string;
  request_count: number;
  avg_ttft_ms: number | null;
  // TODO: 实现 p50/p95 百分位（SQLite 不原生支持 PERCENTILE，需要用 JSON 数组或子查询方案）
  p50_ttft_ms: null;
  p95_ttft_ms: null;
  avg_tps: number | null;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_hit_tokens: number;
  cache_hit_rate: number | null;
}

// 预设周期总秒数（与 PERIOD_OFFSET 对应）
const PERIOD_TOTAL_SEC: Record<MetricsPeriod, number> = {
  "1h": 3600,
  "5h": 18000,
  "6h": 21600,
  "24h": 86400,
  "7d": 604800,
  "30d": 2592000,
};

// --- Metrics routing helpers (BG3: detail/agg table routing) ---

function computeEffectiveTimeRange(period: MetricsPeriod, startTime?: string, endTime?: string) {
  if (startTime && endTime) return { effectiveStart: startTime, effectiveEnd: endTime };
  const now = new Date();
  // Add 1 second to ensure the current second is included in the range.
  // datetime() truncates milliseconds, so 'now' and datetime('now') can be equal,
  // causing created_at < datetime(end) to fail.
  const end = new Date(now.getTime() + MS_PER_SECOND).toISOString();
  const durations: Record<MetricsPeriod, number> = {
    "1h": 3600_000,
    "5h": 18000_000,
    "6h": 21600_000,
    "24h": 86400_000,
    "7d": 604800_000,
    "30d": 2592000_000,
  };
  const start = new Date(now.getTime() - durations[period]).toISOString();
  return { effectiveStart: start, effectiveEnd: end };
}

const BUCKET_SECONDS = 600; // 10 minutes

/**
 * Compute the bucket boundary: floor(now / 600s) * 600s.
 * This is the start of the current (still-incomplete) 10-minute bucket.
 * Data before this boundary is fully settled and should be in metrics_10min.
 * Data at or after this boundary may still be incomplete → use request_metrics.
 */
function computeBucketBoundary(): string {
  const bucketStartSec = Math.floor(Date.now() / MS_PER_SECOND / BUCKET_SECONDS) * BUCKET_SECONDS;
  return toSqliteDatetime(new Date(bucketStartSec * MS_PER_SECOND));
}

function queryAggRouterKeyIdCondition(routerKeyId?: string): {
  aggRouterKeyWhere: string;
  aggRouterKeyParam: unknown[];
} {
  return routerKeyId
    ? { aggRouterKeyWhere: "COALESCE(m.router_key_id, '') = COALESCE(?, '')", aggRouterKeyParam: [routerKeyId] }
    : { aggRouterKeyWhere: "1=1", aggRouterKeyParam: [] };
}

function mergeSummaryResults(detail: MetricsSummaryRow[], agg: MetricsSummaryRow[]): MetricsSummaryRow[] {
  const map = new Map<string, MetricsSummaryRow>();
  for (const row of [...detail, ...agg]) {
    const key = `${row.provider_id}|${row.backend_model}|${row.client_type}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...row });
    } else {
      const mergedInputTokens = existing.total_input_tokens + row.total_input_tokens;
      const mergedOutputTokens = existing.total_output_tokens + row.total_output_tokens;
      const mergedCacheTokens = existing.total_cache_hit_tokens + row.total_cache_hit_tokens;
      const mergedRequestCount = existing.request_count + row.request_count;
      const oldRequestCount = existing.request_count;
      const oldAvgTps = existing.avg_tps;
      existing.avg_ttft_ms = mergedRequestCount > 0
        ? ((existing.avg_ttft_ms ?? 0) * existing.request_count + (row.avg_ttft_ms ?? 0) * row.request_count) / mergedRequestCount
        : null;
      existing.request_count = mergedRequestCount;
      existing.total_input_tokens = mergedInputTokens;
      existing.total_output_tokens = mergedOutputTokens;
      existing.total_cache_hit_tokens = mergedCacheTokens;
      existing.avg_tps = mergedRequestCount > 0
        ? ((oldAvgTps ?? 0) * oldRequestCount + (row.avg_tps ?? 0) * row.request_count) / mergedRequestCount
        : null;
      existing.cache_hit_rate = mergedInputTokens > 0 ? mergedCacheTokens * PERCENT / mergedInputTokens : null;
    }
  }
  return Array.from(map.values()).sort((a, b) => b.request_count - a.request_count);
}

function mergeTimeseriesResults(detail: MetricsTimeseriesRow[], agg: MetricsTimeseriesRow[]): MetricsTimeseriesRow[] {
  const map = new Map<string, MetricsTimeseriesRow>();
  for (const row of [...detail, ...agg]) {
    const existing = map.get(row.time_bucket);
    if (!existing) {
      map.set(row.time_bucket, { ...row });
    } else {
      const totalCount = (existing.count ?? 0) + (row.count ?? 0);
      existing.avg_value = totalCount > 0
        ? ((existing.avg_value ?? 0) * (existing.count ?? 0) + (row.avg_value ?? 0) * (row.count ?? 0)) / totalCount
        : null;
      existing.count = totalCount;
    }
  }
  return Array.from(map.values()).sort((a, b) => a.time_bucket.localeCompare(b.time_bucket));
}

function mergeBreakdownResults(a: ClientTypeBreakdown, b: ClientTypeBreakdown): ClientTypeBreakdown {
  const result: ClientTypeBreakdown = { ...a };
  for (const [k, v] of Object.entries(b)) {
    result[k] = (result[k] ?? 0) + v;
  }
  return result;
}

function queryAggClientTypeBreakdown(
  db: Database.Database,
  startTime: string,
  endTime: string,
  providerId?: string,
  backendModel?: string,
  routerKeyId?: string,
): ClientTypeBreakdown {
  const { aggRouterKeyWhere, aggRouterKeyParam } = queryAggRouterKeyIdCondition(routerKeyId);
  const conditions = ["bucket_time >= datetime(?)", "bucket_time < datetime(?)", aggRouterKeyWhere];
  const params: unknown[] = [startTime, endTime, ...aggRouterKeyParam];
  if (providerId) { conditions.push("provider_id = ?"); params.push(providerId); }
  if (backendModel) { conditions.push("backend_model = ?"); params.push(backendModel); }
  const rows = db.prepare(
    `SELECT client_type, SUM(request_count) AS cnt FROM metrics_10min WHERE ${conditions.join(" AND ")} GROUP BY client_type`,
  ).all(...params) as { client_type: string; cnt: number }[];
  const breakdown: ClientTypeBreakdown = {};
  for (const r of rows) {
    breakdown[r.client_type] = r.cnt;
  }
  return breakdown;
}

function buildTimeCondition(
  period: MetricsPeriod,
  startTime?: string,
  endTime?: string,
): { timeWhere: string; timeParams: unknown[] } {
  if (startTime && endTime) {
    // request_metrics.created_at stores SQLite datetime format (YYYY-MM-DD HH:MM:SS),
    // frontend sends ISO 8601. Use datetime(?) to normalize both for correct comparison.
    return {
      timeWhere: "rm.created_at >= datetime(?) AND rm.created_at < datetime(?)",
      timeParams: [startTime, endTime],
    };
  }
  return {
    timeWhere: "rm.created_at >= datetime('now', ?)",
    timeParams: [PERIOD_OFFSET[period]],
  };
}

export function getMetricsSummary(
  db: Database.Database,
  period: MetricsPeriod,
  providerId?: string,
  backendModel?: string,
  routerKeyId?: string,
  startTime?: string,
  endTime?: string,
  clientType?: string,
): MetricsSummaryRow[] {
  const { effectiveStart, effectiveEnd } = computeEffectiveTimeRange(period, startTime, endTime);
  const boundary = computeBucketBoundary();

  // Pure agg: query range is entirely before the current bucket
  if (effectiveEnd <= boundary) {
    return queryAggSummary(db, period, providerId, backendModel, routerKeyId, startTime, endTime, clientType);
  }

  // Pure detail: query range is entirely within the current bucket
  if (effectiveStart >= boundary) {
    return queryDetailSummary(db, period, providerId, backendModel, routerKeyId, startTime, endTime, clientType);
  }

  // Cross-boundary: agg segment [start, boundary) + detail segment [boundary, end)
  const aggRows = queryAggSummary(db, period, providerId, backendModel, routerKeyId, effectiveStart, boundary, clientType);
  const detailRows = queryDetailSummary(db, period, providerId, backendModel, routerKeyId, boundary, effectiveEnd, clientType);
  return mergeSummaryResults(detailRows, aggRows);
}

/** Query summary from request_metrics (detail table) */
function queryDetailSummary(
  db: Database.Database,
  period: MetricsPeriod,
  providerId?: string,
  backendModel?: string,
  routerKeyId?: string,
  startTime?: string,
  endTime?: string,
  clientType?: string,
): MetricsSummaryRow[] {
  const { timeWhere, timeParams } = buildTimeCondition(period, startTime, endTime);
  const conditions = [timeWhere];
  const params: unknown[] = [...timeParams];

  if (providerId) { conditions.push("rm.provider_id = ?"); params.push(providerId); }
  if (backendModel) { conditions.push("rm.backend_model = ?"); params.push(backendModel); }
  if (routerKeyId) { conditions.push("rm.router_key_id = ?"); params.push(routerKeyId); }
  if (clientType) { conditions.push("rm.client_type = ?"); params.push(clientType); }

  return db.prepare(`
    SELECT
      rm.provider_id, COALESCE(p.name, rm.provider_id) AS provider_name, rm.backend_model, rm.client_type,
      COUNT(*) AS request_count, AVG(rm.ttft_ms) AS avg_ttft_ms, NULL AS p50_ttft_ms, NULL AS p95_ttft_ms,
      CASE WHEN SUM(rm.total_duration_ms) > 0 THEN CAST(SUM(rm.output_tokens) AS REAL) * 1000.0 / SUM(rm.total_duration_ms) ELSE NULL END AS avg_tps,
      COALESCE(SUM(rm.input_tokens), 0) AS total_input_tokens, COALESCE(SUM(rm.output_tokens), 0) AS total_output_tokens,
      COALESCE(SUM(rm.cache_read_tokens), 0) AS total_cache_hit_tokens,
      CASE WHEN SUM(rm.input_tokens) > 0 THEN SUM(rm.cache_read_tokens) * 100.0 / SUM(rm.input_tokens) ELSE NULL END AS cache_hit_rate
    FROM request_metrics rm
    LEFT JOIN providers p ON p.id = rm.provider_id
    WHERE ${conditions.join(" AND ")}
    GROUP BY rm.provider_id, rm.backend_model, rm.client_type ORDER BY request_count DESC
  `).all(...params) as MetricsSummaryRow[];
}

export interface ClientTypeBreakdown {
  [clientType: string]: number;
}

export function getClientTypeBreakdown(
  db: Database.Database,
  period: MetricsPeriod,
  providerId?: string,
  backendModel?: string,
  routerKeyId?: string,
  startTime?: string,
  endTime?: string,
): ClientTypeBreakdown {
  const { effectiveStart, effectiveEnd } = computeEffectiveTimeRange(period, startTime, endTime);
  const boundary = computeBucketBoundary();

  // Pure agg
  if (effectiveEnd <= boundary) {
    return queryAggClientTypeBreakdown(db, effectiveStart, effectiveEnd, providerId, backendModel, routerKeyId);
  }

  // Pure detail
  if (effectiveStart >= boundary) {
    return queryDetailClientTypeBreakdown(db, period, providerId, backendModel, routerKeyId, startTime, endTime);
  }

  // Cross-boundary: agg [start, boundary) + detail [boundary, end)
  const aggBreakdown = queryAggClientTypeBreakdown(db, effectiveStart, boundary, providerId, backendModel, routerKeyId);
  const detailBreakdown = queryDetailClientTypeBreakdown(db, period, providerId, backendModel, routerKeyId, boundary, effectiveEnd);
  return mergeBreakdownResults(detailBreakdown, aggBreakdown);
}

/** Query client type breakdown from request_metrics */
function queryDetailClientTypeBreakdown(
  db: Database.Database,
  period: MetricsPeriod,
  providerId?: string,
  backendModel?: string,
  routerKeyId?: string,
  startTime?: string,
  endTime?: string,
): ClientTypeBreakdown {
  const { timeWhere, timeParams } = buildTimeCondition(period, startTime, endTime);
  const conditions = [timeWhere];
  const params: unknown[] = [...timeParams];

  if (providerId) { conditions.push("rm.provider_id = ?"); params.push(providerId); }
  if (backendModel) { conditions.push("rm.backend_model = ?"); params.push(backendModel); }
  if (routerKeyId) { conditions.push("rm.router_key_id = ?"); params.push(routerKeyId); }

  const rows = db.prepare(`
    SELECT rm.client_type, COUNT(*) AS cnt
    FROM request_metrics rm
    WHERE ${conditions.join(" AND ")}
    GROUP BY rm.client_type
  `).all(...params) as { client_type: string; cnt: number }[];

  const breakdown: ClientTypeBreakdown = {};
  for (const r of rows) {
    breakdown[r.client_type] = r.cnt;
  }
  return breakdown;
}

export interface MetricsTimeseriesRow {
  time_bucket: string;
  avg_value: number | null;
  count: number;
}

const METRIC_EXPR: Record<MetricsMetric, string> = {
  ttft: "AVG(rm.ttft_ms)",
  tps: "CASE WHEN SUM(rm.total_duration_ms) > 0 THEN CAST(SUM(rm.output_tokens) AS REAL) * 1000.0 / SUM(rm.total_duration_ms) ELSE NULL END",
  text_tps: "AVG(rm.text_tps)",
  thinking_tps: "AVG(rm.thinking_tps)",
  tool_use_tps: "AVG(rm.tool_use_tps)",
  non_thinking_tps: "AVG(rm.non_thinking_tps)",
  total_tps: "CASE WHEN SUM(rm.total_duration_ms) > 0 THEN CAST(SUM(rm.output_tokens) AS REAL) * 1000.0 / SUM(rm.total_duration_ms) ELSE NULL END",
  tokens: "SUM(rm.output_tokens)",
  cache_rate: "CASE WHEN SUM(rm.input_tokens) > 0 THEN SUM(rm.cache_read_tokens) * 1.0 / SUM(rm.input_tokens) ELSE NULL END",
  request_count: "COUNT(*)",
  input_tokens: "SUM(rm.input_tokens)",
  output_tokens: "SUM(rm.output_tokens)",
  cache_hit_tokens: "SUM(rm.cache_read_tokens)",
};

export function getMetricsTimeseries(
  db: Database.Database,
  period: MetricsPeriod,
  metric: MetricsMetric,
  providerId?: string,
  backendModel?: string,
  routerKeyId?: string,
  startTime?: string,
  endTime?: string,
  clientType?: string,
): MetricsTimeseriesRow[] {
  const { effectiveStart, effectiveEnd } = computeEffectiveTimeRange(period, startTime, endTime);
  const boundary = computeBucketBoundary();

  // Pure agg: range is entirely before the current bucket
  if (effectiveEnd <= boundary) {
    return queryAggTimeseries(db, period, metric, providerId, backendModel, routerKeyId, startTime, endTime, clientType);
  }

  // Pure detail: range is entirely within the current bucket
  if (effectiveStart >= boundary) {
    return queryDetailTimeseries(db, period, metric, providerId, backendModel, routerKeyId, startTime, endTime, clientType);
  }

  // Cross-boundary: agg segment [start, boundary) + detail segment [boundary, end)
  const aggRows = queryAggTimeseries(db, period, metric, providerId, backendModel, routerKeyId, effectiveStart, boundary, clientType);
  const detailRows = queryDetailTimeseries(db, period, metric, providerId, backendModel, routerKeyId, boundary, effectiveEnd, clientType);
  return mergeTimeseriesResults(detailRows, aggRows);
}

/** Query timeseries from request_metrics (detail table) */
function queryDetailTimeseries(
  db: Database.Database,
  period: MetricsPeriod,
  metric: MetricsMetric,
  providerId?: string,
  backendModel?: string,
  routerKeyId?: string,
  startTime?: string,
  endTime?: string,
  clientType?: string,
): MetricsTimeseriesRow[] {
  const bucketSec = (startTime && endTime)
    ? calcBucketSec((new Date(endTime).getTime() - new Date(startTime).getTime()) / MS_PER_SECOND)
    : calcBucketSec(PERIOD_TOTAL_SEC[period]);
  const { timeWhere, timeParams } = buildTimeCondition(period, startTime, endTime);
  const conditions = [timeWhere];
  const params: unknown[] = [...timeParams];

  if (providerId) { conditions.push("rm.provider_id = ?"); params.push(providerId); }
  if (backendModel) { conditions.push("rm.backend_model = ?"); params.push(backendModel); }
  if (routerKeyId) { conditions.push("rm.router_key_id = ?"); params.push(routerKeyId); }
  if (clientType) { conditions.push("rm.client_type = ?"); params.push(clientType); }

  const where = conditions.join(" AND ");
  const expr = METRIC_EXPR[metric];

  const rows = db.prepare(`
    SELECT
      (unixepoch(rm.created_at) / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS bucket_key,
      ${expr} AS avg_value,
      COUNT(*) AS count
    FROM request_metrics rm
    WHERE ${where}
    GROUP BY bucket_key
    ORDER BY bucket_key ASC
  `).all(bucketSec, bucketSec, ...params) as { bucket_key: number; avg_value: number | null; count: number }[];

  return rows.map((r) => ({
    time_bucket: new Date(r.bucket_key * MS_PER_SECOND).toISOString(),
    avg_value: r.avg_value,
    count: r.count,
  }));
}

export function deleteMetricsBefore(db: Database.Database, beforeDate: string): number {
  const stmt = getCachedStmt(
    db,
    `DELETE FROM request_metrics WHERE created_at < ?`
  );
  const result = stmt.run(beforeDate);
  return result.changes;
}

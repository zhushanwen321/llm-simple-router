import Database from "better-sqlite3";
import { getCachedStmt } from "./helpers.js";
import type { MetricsPeriod, MetricsMetric, MetricsSummaryRow, MetricsTimeseriesRow } from "./metrics.js";

const MILLISECONDS_PER_SECOND = 1000;

// --- metrics_10min table types ---

export interface Metrics10minRow {
  bucket_time: string;
  router_key_id: string;
  provider_id: string;
  backend_model: string;
  client_type: string;
  api_type: string;
  request_count: number;
  sum_input_tokens: number;
  sum_output_tokens: number;
  sum_cache_read_tokens: number;
  sum_cache_creation_tokens: number;
  sum_total_duration_ms: number;
  sum_ttft_ms: number;
  sum_thinking_tokens: number;
  sum_text_tokens: number;
  sum_tool_use_tokens: number;
  sum_thinking_duration_ms: number;
  sum_text_duration_ms: number;
  sum_tool_use_duration_ms: number;
}

// --- UPSERT ---

const UPSERT_AGG_SQL = `
INSERT INTO metrics_10min (
  bucket_time, router_key_id, provider_id, backend_model, client_type, api_type,
  request_count, sum_input_tokens, sum_output_tokens, sum_cache_read_tokens,
  sum_cache_creation_tokens, sum_total_duration_ms, sum_ttft_ms,
  sum_thinking_tokens, sum_text_tokens, sum_tool_use_tokens,
  sum_thinking_duration_ms, sum_text_duration_ms, sum_tool_use_duration_ms
) VALUES (
  datetime(floor(unixepoch() / 600) * 600, 'unixepoch'),
  COALESCE(?, ''),
  ?, ?, ?, ?,
  1, ?, ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?, ?
)
ON CONFLICT (bucket_time, router_key_id, provider_id, backend_model, client_type, api_type)
DO UPDATE SET
  request_count = request_count + 1,
  sum_input_tokens = sum_input_tokens + excluded.sum_input_tokens,
  sum_output_tokens = sum_output_tokens + excluded.sum_output_tokens,
  sum_cache_read_tokens = sum_cache_read_tokens + excluded.sum_cache_read_tokens,
  sum_cache_creation_tokens = sum_cache_creation_tokens + excluded.sum_cache_creation_tokens,
  sum_total_duration_ms = sum_total_duration_ms + excluded.sum_total_duration_ms,
  sum_ttft_ms = sum_ttft_ms + excluded.sum_ttft_ms,
  sum_thinking_tokens = sum_thinking_tokens + excluded.sum_thinking_tokens,
  sum_text_tokens = sum_text_tokens + excluded.sum_text_tokens,
  sum_tool_use_tokens = sum_tool_use_tokens + excluded.sum_tool_use_tokens,
  sum_thinking_duration_ms = sum_thinking_duration_ms + excluded.sum_thinking_duration_ms,
  sum_text_duration_ms = sum_text_duration_ms + excluded.sum_text_duration_ms,
  sum_tool_use_duration_ms = sum_tool_use_duration_ms + excluded.sum_tool_use_duration_ms
`;

export function upsertAggBucket(
  db: Database.Database,
  entry: {
    router_key_id?: string | null;
    provider_id: string;
    backend_model: string;
    client_type?: string;
    api_type: string;
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_tokens?: number | null;
    cache_creation_tokens?: number | null;
    total_duration_ms?: number | null;
    ttft_ms?: number | null;
    thinking_tokens?: number | null;
    text_tokens?: number | null;
    tool_use_tokens?: number | null;
    thinking_duration_ms?: number | null;
    non_thinking_duration_ms?: number | null;
  },
): void {
  getCachedStmt(db, UPSERT_AGG_SQL).run(
    entry.router_key_id ?? null,
    entry.provider_id,
    entry.backend_model,
    entry.client_type ?? "unknown",
    entry.api_type,
    entry.input_tokens ?? 0,
    entry.output_tokens ?? 0,
    entry.cache_read_tokens ?? 0,
    entry.cache_creation_tokens ?? 0,
    entry.total_duration_ms ?? 0,
    entry.ttft_ms ?? 0,
    entry.thinking_tokens ?? 0,
    entry.text_tokens ?? 0,
    entry.tool_use_tokens ?? 0,
    entry.thinking_duration_ms ?? 0,
    entry.non_thinking_duration_ms ?? 0,
    0, // tool_use_duration_ms — MetricsInsert 不提供细分，归入 non_thinking_duration_ms
  );
}

// --- Activity chart query ---

export function queryAggActivity(
  db: Database.Database,
  filters?: { routerKeyId?: string; providerId?: string },
): { bucket_time: string; request_count: number }[] {
  const conditions = ["bucket_time >= datetime('now', '-30 days')"];
  const params: unknown[] = [];

  if (filters?.routerKeyId) {
    conditions.push("router_key_id = ?");
    params.push(filters.routerKeyId);
  }
  if (filters?.providerId) {
    conditions.push("provider_id = ?");
    params.push(filters.providerId);
  }

  const where = conditions.join(" AND ");
  return getCachedStmt(
    db,
    `SELECT bucket_time, SUM(request_count) AS request_count
     FROM metrics_10min
     WHERE ${where}
     GROUP BY bucket_time
     ORDER BY bucket_time ASC`,
  ).all(...params) as { bucket_time: string; request_count: number }[];
}

// --- Time condition builder for 10min aggregation table ---

const AGG_PERIOD_OFFSET: Record<MetricsPeriod, string> = {
  "1h": "-1 hours",
  "5h": "-5 hours",
  "6h": "-6 hours",
  "24h": "-1 day",
  "7d": "-7 days",
  "30d": "-30 days",
};

function buildAggTimeCondition(
  period: MetricsPeriod,
  startTime?: string,
  endTime?: string,
): { timeWhere: string; timeParams: unknown[] } {
  if (startTime && endTime) {
    return {
      timeWhere: "m.bucket_time >= datetime(?) AND m.bucket_time < datetime(?)",
      timeParams: [startTime, endTime],
    };
  }
  return {
    timeWhere: "m.bucket_time >= datetime('now', ?)",
    timeParams: [AGG_PERIOD_OFFSET[period]],
  };
}

// --- Summary query (供 BG3 使用) ---

export function queryAggSummary(
  db: Database.Database,
  period: MetricsPeriod,
  providerId?: string,
  backendModel?: string,
  routerKeyId?: string,
  startTime?: string,
  endTime?: string,
  clientType?: string,
): MetricsSummaryRow[] {
  const { timeWhere, timeParams } = buildAggTimeCondition(period, startTime, endTime);
  const conditions = [timeWhere];
  const params: unknown[] = [...timeParams];

  if (providerId) { conditions.push("m.provider_id = ?"); params.push(providerId); }
  if (backendModel) { conditions.push("m.backend_model = ?"); params.push(backendModel); }
  if (routerKeyId) { conditions.push("m.router_key_id = ?"); params.push(routerKeyId); }
  if (clientType) { conditions.push("m.client_type = ?"); params.push(clientType); }

  const where = conditions.join(" AND ");

  return getCachedStmt(
    db,
    `SELECT
      m.provider_id, COALESCE(p.name, m.provider_id) AS provider_name,
      m.backend_model, m.client_type,
      SUM(m.request_count) AS request_count,
      CASE WHEN SUM(m.request_count) > 0 THEN SUM(m.sum_ttft_ms) / SUM(m.request_count) ELSE NULL END AS avg_ttft_ms,
      NULL AS p50_ttft_ms, NULL AS p95_ttft_ms,
      CASE WHEN SUM(m.sum_total_duration_ms) > 0
        THEN CAST(SUM(m.sum_output_tokens) AS REAL) * 1000.0 / SUM(m.sum_total_duration_ms)
        ELSE NULL END AS avg_tps,
      SUM(m.sum_input_tokens) AS total_input_tokens,
      SUM(m.sum_output_tokens) AS total_output_tokens,
      SUM(m.sum_cache_read_tokens) AS total_cache_hit_tokens,
      CASE WHEN SUM(m.sum_input_tokens) > 0
        THEN SUM(m.sum_cache_read_tokens) * 100.0 / SUM(m.sum_input_tokens)
        ELSE NULL END AS cache_hit_rate
    FROM metrics_10min m
    LEFT JOIN providers p ON p.id = m.provider_id
    WHERE ${where}
    GROUP BY m.provider_id, m.backend_model, m.client_type
    ORDER BY request_count DESC`,
  ).all(...params) as MetricsSummaryRow[];
}

// --- Timeseries query (供 BG3 使用) ---

export const AGG_METRIC_EXPR: Record<MetricsMetric, string> = {
  ttft: "SUM(m.sum_ttft_ms) / CASE WHEN SUM(m.request_count) > 0 THEN SUM(m.request_count) ELSE 1 END",
  tps: "CASE WHEN SUM(m.sum_total_duration_ms) > 0 THEN CAST(SUM(m.sum_output_tokens) AS REAL) * 1000.0 / SUM(m.sum_total_duration_ms) ELSE NULL END",
  text_tps: "CASE WHEN SUM(m.sum_text_duration_ms) > 0 THEN CAST(SUM(m.sum_text_tokens) AS REAL) * 1000.0 / SUM(m.sum_text_duration_ms) ELSE NULL END",
  thinking_tps: "CASE WHEN SUM(m.sum_thinking_duration_ms) > 0 THEN CAST(SUM(m.sum_thinking_tokens) AS REAL) * 1000.0 / SUM(m.sum_thinking_duration_ms) ELSE NULL END",
  tool_use_tps: "CASE WHEN SUM(m.sum_tool_use_duration_ms) > 0 THEN CAST(SUM(m.sum_tool_use_tokens) AS REAL) * 1000.0 / SUM(m.sum_tool_use_duration_ms) ELSE NULL END",
  non_thinking_tps: "CASE WHEN SUM(m.sum_text_duration_ms) + SUM(m.sum_tool_use_duration_ms) > 0 THEN CAST(SUM(m.sum_text_tokens) + SUM(m.sum_tool_use_tokens) AS REAL) * 1000.0 / (SUM(m.sum_text_duration_ms) + SUM(m.sum_tool_use_duration_ms)) ELSE NULL END",
  total_tps: "CASE WHEN SUM(m.sum_total_duration_ms) > 0 THEN CAST(SUM(m.sum_output_tokens) AS REAL) * 1000.0 / SUM(m.sum_total_duration_ms) ELSE NULL END",
  tokens: "SUM(m.sum_output_tokens)",
  cache_rate: "CASE WHEN SUM(m.sum_input_tokens) > 0 THEN SUM(m.sum_cache_read_tokens) * 1.0 / SUM(m.sum_input_tokens) ELSE NULL END",
  request_count: "SUM(m.request_count)",
  input_tokens: "SUM(m.sum_input_tokens)",
  output_tokens: "SUM(m.sum_output_tokens)",
  cache_hit_tokens: "SUM(m.sum_cache_read_tokens)",
};

const AGG_PERIOD_TOTAL_SEC: Record<MetricsPeriod, number> = {
  "1h": 3600,
  "5h": 18000,
  "6h": 21600,
  "24h": 86400,
  "7d": 604800,
  "30d": 2592000,
};

const MIN_BUCKET_SEC = 60;
const DATA_POINT_COUNT = 10;

function calcBucketSec(totalSec: number): number {
  return Math.max(MIN_BUCKET_SEC, Math.round(totalSec / DATA_POINT_COUNT));
}

export function queryAggTimeseries(
  db: Database.Database,
  period: MetricsPeriod,
  metric: MetricsMetric,
  providerId?: string,
  backendModel?: string,
  routerKeyId?: string,
  startTime?: string,
  endTime?: string,
): MetricsTimeseriesRow[] {
  const totalSec = (startTime && endTime)
    ? (new Date(endTime).getTime() - new Date(startTime).getTime()) / MILLISECONDS_PER_SECOND
    : AGG_PERIOD_TOTAL_SEC[period];
  const bucketSec = calcBucketSec(totalSec);
  const { timeWhere, timeParams } = buildAggTimeCondition(period, startTime, endTime);
  const conditions = [timeWhere];
  const params: unknown[] = [...timeParams];

  if (providerId) { conditions.push("m.provider_id = ?"); params.push(providerId); }
  if (backendModel) { conditions.push("m.backend_model = ?"); params.push(backendModel); }
  if (routerKeyId) { conditions.push("m.router_key_id = ?"); params.push(routerKeyId); }

  const where = conditions.join(" AND ");
  const expr = AGG_METRIC_EXPR[metric];

  const rows = getCachedStmt(
    db,
    `SELECT
      (unixepoch(m.bucket_time) / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS bucket_key,
      ${expr} AS avg_value,
      SUM(m.request_count) AS count
    FROM metrics_10min m
    WHERE ${where}
    GROUP BY bucket_key
    ORDER BY bucket_key ASC`,
  ).all(bucketSec, bucketSec, ...params) as { bucket_key: number; avg_value: number | null; count: number }[];

  return rows.map((r) => ({
    time_bucket: new Date(r.bucket_key * MILLISECONDS_PER_SECOND).toISOString(),
    avg_value: r.avg_value,
    count: r.count,
  }));
}

// --- Stats query (供 BG3 使用) ---

export interface AggStats {
  totalRequests: number;
  avgTps: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export function queryAggStats(
  db: Database.Database,
  startTime: string,
  endTime: string,
  routerKeyId?: string,
  providerId?: string,
  backendModel?: string,
): AggStats {
  const conditions = [
    "m.bucket_time >= datetime(?)",
    "m.bucket_time < datetime(?)",
  ];
  const params: unknown[] = [startTime, endTime];

  if (routerKeyId) { conditions.push("m.router_key_id = ?"); params.push(routerKeyId); }
  if (providerId) { conditions.push("m.provider_id = ?"); params.push(providerId); }
  if (backendModel) { conditions.push("m.backend_model = ?"); params.push(backendModel); }

  const where = conditions.join(" AND ");

  const row = getCachedStmt(
    db,
    `SELECT
      SUM(m.request_count) AS total_requests,
      CASE WHEN SUM(m.sum_total_duration_ms) > 0
        THEN CAST(SUM(m.sum_output_tokens) AS REAL) * 1000.0 / SUM(m.sum_total_duration_ms)
        ELSE NULL END AS avg_tps,
      COALESCE(SUM(m.sum_input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(m.sum_output_tokens), 0) AS total_output_tokens
    FROM metrics_10min m
    WHERE ${where}`,
  ).get(...params) as { total_requests: number; avg_tps: number | null; total_input_tokens: number; total_output_tokens: number } | undefined;

  return {
    totalRequests: row?.total_requests ?? 0,
    avgTps: row?.avg_tps ?? 0,
    totalInputTokens: row?.total_input_tokens ?? 0,
    totalOutputTokens: row?.total_output_tokens ?? 0,
  };
}

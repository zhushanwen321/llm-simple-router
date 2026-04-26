import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { MS_PER_SECOND } from "../constants.js";

export type MetricsPeriod = "1h" | "5h" | "6h" | "24h" | "7d" | "30d";
export type MetricsMetric = "ttft" | "tps" | "tokens" | "cache_rate" | "request_count" | "input_tokens" | "output_tokens" | "cache_hit_tokens";

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
};

export function insertMetrics(db: Database.Database, m: MetricsInsert): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO request_metrics (id, request_log_id, provider_id, backend_model, api_type, router_key_id, status_code, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, ttft_ms, total_duration_ms, tokens_per_second, stop_reason, is_complete)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, m.request_log_id, m.provider_id, m.backend_model, m.api_type,
    m.router_key_id ?? null, m.status_code ?? null,
    m.input_tokens ?? null, m.output_tokens ?? null,
    m.cache_creation_tokens ?? null, m.cache_read_tokens ?? null,
    m.ttft_ms ?? null, m.total_duration_ms ?? null,
    m.tokens_per_second ?? null, m.stop_reason ?? null, m.is_complete ?? 1,
  );
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

const BUCKET_SECONDS: Record<MetricsPeriod, number> = {
  "1h": 60,
  "5h": 300,
  "6h": 300,
  "24h": 900,
  "7d": 3600,
  "30d": 14400,
};

// unix epoch 秒转毫秒的乘数

export interface MetricsSummaryRow {
  provider_id: string;
  provider_name: string;
  backend_model: string;
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

// 时间跨度（秒）→ 桶大小（秒）的阶梯映射，与 BUCKET_SECONDS 保持对齐
const BUCKET_THRESHOLDS = [
  { maxSec: 3600, bucketSec: 60 },     // ≤1h: 1min
  { maxSec: 21600, bucketSec: 300 },    // ≤6h: 5min
  { maxSec: 86400, bucketSec: 900 },    // ≤1d: 15min
  { maxSec: 604800, bucketSec: 3600 },  // ≤7d: 1h
] as const;
const FALLBACK_BUCKET_SEC = 14400;      // >7d: 4h

function calculateBucketSeconds(startTime: string, endTime: string): number {
  const ms = new Date(endTime).getTime() - new Date(startTime).getTime();
  const sec = ms / MS_PER_SECOND;
  const match = BUCKET_THRESHOLDS.find((t) => sec <= t.maxSec);
  return match ? match.bucketSec : FALLBACK_BUCKET_SEC;
}

function buildTimeCondition(
  period: MetricsPeriod,
  startTime?: string,
  endTime?: string,
): { timeWhere: string; timeParams: unknown[] } {
  if (startTime && endTime) {
    // request_metrics.created_at 用 datetime('now') 格式 (YYYY-MM-DD HH:MM:SS)，
    // 前端传入 ISO 8601，需要转换格式以匹配字符串比较
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
): MetricsSummaryRow[] {
  const { timeWhere, timeParams } = buildTimeCondition(period, startTime, endTime);
  const conditions = ["rm.is_complete = 1", timeWhere];
  const params: unknown[] = [...timeParams];
  const joins = ["LEFT JOIN providers p ON p.id = rm.provider_id"];

  if (providerId) { conditions.push("rm.provider_id = ?"); params.push(providerId); }
  if (backendModel) { conditions.push("rm.backend_model = ?"); params.push(backendModel); }
  if (routerKeyId) {
    conditions.push("rm.router_key_id = ?");
    params.push(routerKeyId);
  }

  return db.prepare(`
    SELECT
      rm.provider_id, COALESCE(p.name, rm.provider_id) AS provider_name, rm.backend_model,
      COUNT(*) AS request_count, AVG(rm.ttft_ms) AS avg_ttft_ms, NULL AS p50_ttft_ms, NULL AS p95_ttft_ms,
      AVG(rm.tokens_per_second) AS avg_tps,
      COALESCE(SUM(rm.input_tokens), 0) AS total_input_tokens, COALESCE(SUM(rm.output_tokens), 0) AS total_output_tokens,
      COALESCE(SUM(rm.cache_read_tokens), 0) AS total_cache_hit_tokens,
      CASE WHEN SUM(rm.input_tokens) > 0 THEN SUM(rm.cache_read_tokens) * 1.0 / SUM(rm.input_tokens) ELSE NULL END AS cache_hit_rate
    FROM request_metrics rm
    ${joins.join(" ")}
    WHERE ${conditions.join(" AND ")}
    GROUP BY rm.provider_id, rm.backend_model ORDER BY request_count DESC
  `).all(...params) as MetricsSummaryRow[];
}

export interface MetricsTimeseriesRow {
  time_bucket: string;
  avg_value: number | null;
  count: number;
}

const METRIC_EXPR: Record<MetricsMetric, string> = {
  ttft: "AVG(rm.ttft_ms)",
  tps: "AVG(rm.tokens_per_second)",
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
): MetricsTimeseriesRow[] {
  const bucketSec = (startTime && endTime)
    ? calculateBucketSeconds(startTime, endTime)
    : BUCKET_SECONDS[period];
  const { timeWhere, timeParams } = buildTimeCondition(period, startTime, endTime);
  const conditions = ["rm.is_complete = 1", timeWhere];
  const params: unknown[] = [...timeParams];

  if (providerId) { conditions.push("rm.provider_id = ?"); params.push(providerId); }
  if (backendModel) { conditions.push("rm.backend_model = ?"); params.push(backendModel); }
  if (routerKeyId) { conditions.push("rm.router_key_id = ?"); params.push(routerKeyId); }

  const where = conditions.join(" AND ");
  const expr = METRIC_EXPR[metric];

  const rows = db.prepare(`
    SELECT
      (unixepoch(rm.created_at) / ?) * ? AS bucket_key,
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

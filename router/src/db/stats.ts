import Database from "better-sqlite3";
import { queryAggStats, BUCKET_SECONDS } from "./metrics-10min.js";
import { MS_PER_SECOND } from "../core/constants.js";
import { toSqliteDatetime } from "../utils/datetime.js";

/** 获取指定条件下的最近一条 metric 的 created_at（用于窗口补齐定位，不限制 is_complete） */
export function getLatestMetricTime(
  db: Database.Database,
  providerId?: string,
  routerKeyId?: string,
): string | null {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (providerId) {
    conditions.push("rm.provider_id = ?");
    params.push(providerId);
  }
  if (routerKeyId) {
    conditions.push("rm.router_key_id = ?");
    params.push(routerKeyId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const row = db.prepare(
    `SELECT rm.created_at FROM request_metrics rm ${where} ORDER BY rm.created_at DESC LIMIT 1`,
  ).get(...params) as { created_at: string } | undefined;
  return row?.created_at ?? null;
}

export interface Stats {
  totalRequests: number;
  successRate: number | null;
  avgTps: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  is_approximate: boolean;
}

interface StatsRow {
  total_requests: number;
  success_count: number;
  avg_tps: number | null;
  total_input_tokens: number;
  total_output_tokens: number;
}

// BUCKET_SECONDS imported from metrics-10min

/**
 * Compute the bucket boundary: floor(now / 600s) * 600s.
 * Data before this boundary is fully settled (in metrics_10min).
 * Data at or after this boundary may still be incomplete (in request_metrics).
 */
export function computeBucketBoundary(): string {
  const bucketStartSec = Math.floor(Date.now() / MS_PER_SECOND / BUCKET_SECONDS) * BUCKET_SECONDS;
  return toSqliteDatetime(new Date(bucketStartSec * MS_PER_SECOND));
}

export function getStats(
  db: Database.Database,
  startTime: string,
  endTime: string,
  routerKeyId?: string,
  providerId?: string,
  backendModel?: string,
  clientType?: string,
): Stats {
  const boundary = computeBucketBoundary();

  // Pure agg: entire range is before the current bucket
  if (endTime <= boundary) {
    const aggStats = queryAggStats(db, startTime, endTime, routerKeyId, providerId, backendModel, clientType);
    return {
      totalRequests: aggStats.totalRequests,
      successRate: null, // agg table does not store status_code
      avgTps: aggStats.avgTps,
      totalInputTokens: aggStats.totalInputTokens,
      totalOutputTokens: aggStats.totalOutputTokens,
      is_approximate: true,
    };
  }

  // Pure detail: entire range is within the current bucket
  if (startTime >= boundary) {
    return queryDetailStats(db, startTime, endTime, routerKeyId, providerId, backendModel, clientType, false);
  }

  // Cross-boundary: agg segment [start, boundary) + detail segment [boundary, end)
  const aggStats = queryAggStats(db, startTime, boundary, routerKeyId, providerId, backendModel, clientType);
  const detailStats = queryDetailStats(db, boundary, endTime, routerKeyId, providerId, backendModel, clientType, false);

  const mergedTotalRequests = detailStats.totalRequests + aggStats.totalRequests;
  const mergedTotalInputTokens = detailStats.totalInputTokens + aggStats.totalInputTokens;
  const mergedTotalOutputTokens = detailStats.totalOutputTokens + aggStats.totalOutputTokens;
  let mergedAvgTps = 0;
  if (mergedTotalRequests > 0) {
    mergedAvgTps = ((detailStats.avgTps) * detailStats.totalRequests + aggStats.avgTps * aggStats.totalRequests) / mergedTotalRequests;
  }
  // successRate from detail segment only; agg has no status_code
  const mergedSuccessCount = detailStats.successRate !== null
    ? detailStats.successRate * detailStats.totalRequests
    : 0;
  const successRate = mergedTotalRequests > 0
    ? mergedSuccessCount / mergedTotalRequests
    : null;

  return {
    totalRequests: mergedTotalRequests,
    successRate,
    avgTps: mergedAvgTps,
    totalInputTokens: mergedTotalInputTokens,
    totalOutputTokens: mergedTotalOutputTokens,
    is_approximate: true,
  };
}

function queryDetailStats(
  db: Database.Database,
  startTime: string,
  endTime: string,
  routerKeyId?: string,
  providerId?: string,
  backendModel?: string,
  clientType?: string,
  _isApproximate: boolean = false,
): Stats {
  const conditions = [
    "rm.created_at >= datetime(?)",
    "rm.created_at < datetime(?)",
  ];
  const params: unknown[] = [startTime, endTime];
  if (routerKeyId) {
    conditions.push("rm.router_key_id = ?");
    params.push(routerKeyId);
  }
  if (providerId) {
    conditions.push("rm.provider_id = ?");
    params.push(providerId);
  }
  if (backendModel) {
    conditions.push("rm.backend_model = ?");
    params.push(backendModel);
  }
  if (clientType) {
    conditions.push("rm.client_type = ?");
    params.push(clientType);
  }
  const where = conditions.join(" AND ");

  const row = db.prepare(`
    SELECT
      COUNT(*) AS total_requests,
      SUM(CASE WHEN rm.status_code >= 200 AND rm.status_code < 300 THEN 1 ELSE 0 END) AS success_count,
      CASE WHEN SUM(rm.total_duration_ms) > 0 THEN CAST(SUM(rm.output_tokens) AS REAL) * 1000.0 / SUM(rm.total_duration_ms) ELSE NULL END AS avg_tps,
      COALESCE(SUM(rm.input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(rm.output_tokens), 0) AS total_output_tokens
    FROM request_metrics rm
    WHERE ${where}
  `).get(...params) as StatsRow;

  const total = row?.total_requests ?? 0;
  return {
    totalRequests: total,
    successRate: total > 0 ? (row?.success_count ?? 0) / total : 0,
    avgTps: row?.avg_tps ?? 0,
    totalInputTokens: row?.total_input_tokens ?? 0,
    totalOutputTokens: row?.total_output_tokens ?? 0,
    is_approximate: _isApproximate,
  };
}

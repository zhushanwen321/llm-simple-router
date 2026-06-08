import Database from "better-sqlite3";
import { getMetricsDetailDays } from "./settings.js";
import { queryAggStats } from "./metrics-10min.js";
import { SECONDS_PER_DAY, MS_PER_SECOND } from "../core/constants.js";

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
  successRate: number;
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

export function getStats(
  db: Database.Database,
  startTime: string,
  endTime: string,
  routerKeyId?: string,
  providerId?: string,
  backendModel?: string,
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
  const detailDays = getMetricsDetailDays(db);
  const now = new Date();
  const cutoffTime = new Date(now.getTime() - detailDays * SECONDS_PER_DAY * MS_PER_SECOND).toISOString();
  const isApproximate = endTime > cutoffTime;

  if (!isApproximate) {
    // 全量走聚合表
    const aggStats = queryAggStats(db, startTime, endTime, routerKeyId, providerId, backendModel);
    return {
      totalRequests: aggStats.totalRequests,
      successRate: 0,
      avgTps: aggStats.avgTps,
      totalInputTokens: aggStats.totalInputTokens,
      totalOutputTokens: aggStats.totalOutputTokens,
      is_approximate: true,
    };
  }

  if (startTime >= cutoffTime) {
    // 全量走明细表
    return {
      totalRequests: total,
      successRate: total > 0 ? (row?.success_count ?? 0) / total : 0,
      avgTps: row?.avg_tps ?? 0,
      totalInputTokens: row?.total_input_tokens ?? 0,
      totalOutputTokens: row?.total_output_tokens ?? 0,
      is_approximate: false,
    };
  }

  // 跨越分界线：聚合表段
  const aggStats = queryAggStats(db, startTime, cutoffTime, routerKeyId, providerId, backendModel);

  // 合并：totalRequests/totalInputTokens/totalOutputTokens 求和，avg_tps 加权平均
  const mergedTotalRequests = total + aggStats.totalRequests;
  const mergedTotalInputTokens = (row?.total_input_tokens ?? 0) + aggStats.totalInputTokens;
  const mergedTotalOutputTokens = (row?.total_output_tokens ?? 0) + aggStats.totalOutputTokens;
  const mergedSuccessCount = row?.success_count ?? 0; // 聚合表无 status_code，只取明细段成功数
  let mergedAvgTps = 0;
  if (total + aggStats.totalRequests > 0) {
    mergedAvgTps = ((row?.avg_tps ?? 0) * total + aggStats.avgTps * aggStats.totalRequests) / (total + aggStats.totalRequests);
  }

  return {
    totalRequests: mergedTotalRequests,
    successRate: mergedTotalRequests > 0 ? mergedSuccessCount / mergedTotalRequests : 0,
    avgTps: mergedAvgTps,
    totalInputTokens: mergedTotalInputTokens,
    totalOutputTokens: mergedTotalOutputTokens,
    is_approximate: true,
  };
}

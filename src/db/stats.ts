import Database from "better-sqlite3";

export type StatsPeriod = "1h" | "6h" | "24h" | "7d" | "30d";

export interface Stats {
  totalRequests: number;
  successRate: number;
  avgTps: number;
  totalTokens: number;
}

interface StatsRow {
  total_requests: number;
  success_count: number;
  avg_tps: number | null;
  total_tokens: number;
}

const PERIOD_OFFSET: Record<StatsPeriod, string> = {
  "1h": "-1 hours",
  "6h": "-6 hours",
  "24h": "-1 day",
  "7d": "-7 days",
  "30d": "-30 days",
};

export function getStats(db: Database.Database, period: StatsPeriod, routerKeyId?: string): Stats {
  const offset = PERIOD_OFFSET[period];

  const conditions = ["rm.is_complete = 1", "rm.created_at >= datetime('now', ?)"];
  const params: unknown[] = [offset];
  if (routerKeyId) { conditions.push("rl.router_key_id = ?"); params.push(routerKeyId); }
  const where = conditions.join(" AND ");

  const row = db.prepare(`
    SELECT
      COUNT(*) AS total_requests,
      SUM(CASE WHEN rl.status_code >= 200 AND rl.status_code < 300 THEN 1 ELSE 0 END) AS success_count,
      AVG(rm.tokens_per_second) AS avg_tps,
      COALESCE(SUM(rm.input_tokens), 0) + COALESCE(SUM(rm.output_tokens), 0) AS total_tokens
    FROM request_metrics rm
    JOIN request_logs rl ON rl.id = rm.request_log_id
    WHERE ${where}
  `).get(...params) as StatsRow;

  const total = row?.total_requests ?? 0;
  return {
    totalRequests: total,
    successRate: total > 0 ? (row?.success_count ?? 0) / total : 0,
    avgTps: row?.avg_tps ?? 0,
    totalTokens: row?.total_tokens ?? 0,
  };
}

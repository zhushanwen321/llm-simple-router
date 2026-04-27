import Database from "better-sqlite3";

export interface Stats {
  totalRequests: number;
  successRate: number;
  avgTps: number;
  totalInputTokens: number;
  totalOutputTokens: number;
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
    "rm.is_complete = 1",
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
      AVG(rm.tokens_per_second) AS avg_tps,
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
  };
}

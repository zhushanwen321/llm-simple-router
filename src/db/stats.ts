import Database from "better-sqlite3";

export interface Stats {
  totalRequests: number;
  successRate: number;
  avgLatency: number;
  requestsByType: Record<string, number>;
  recentRequests: number;
}

interface CountRow { count: number }
interface AvgRow { avg: number | null }

export function getStats(db: Database.Database, routerKeyId?: string): Stats {
  const baseWhere = routerKeyId ? "WHERE router_key_id = ?" : "";
  const params = routerKeyId ? [routerKeyId] : [];
  const total = (db.prepare(`SELECT COUNT(*) as count FROM request_logs ${baseWhere}`).get(...params) as CountRow).count;
  const successWhere = routerKeyId ? "WHERE router_key_id = ? AND status_code >= 200 AND status_code < 300" : "WHERE status_code >= 200 AND status_code < 300";
  const successCount = (db.prepare(`SELECT COUNT(*) as count FROM request_logs ${successWhere}`).get(...params) as CountRow).count;
  const avgWhere = routerKeyId ? "WHERE router_key_id = ? AND latency_ms IS NOT NULL" : "WHERE latency_ms IS NOT NULL";
  const avgResult = db.prepare(`SELECT AVG(latency_ms) as avg FROM request_logs ${avgWhere}`).get(...params) as AvgRow;
  const recentWhere = routerKeyId ? "WHERE router_key_id = ? AND created_at >= datetime('now', '-1 day')" : "WHERE created_at >= datetime('now', '-1 day')";
  const recentCount = (db.prepare(`SELECT COUNT(*) as count FROM request_logs ${recentWhere}`).get(...params) as CountRow).count;
  const typeWhere = routerKeyId ? "WHERE router_key_id = ?" : "";
  const requestsByType: Record<string, number> = {};
  for (const row of db.prepare(`SELECT api_type, COUNT(*) as count FROM request_logs ${typeWhere} GROUP BY api_type`).all(...params) as { api_type: string; count: number }[]) {
    requestsByType[row.api_type] = row.count;
  }
  return { totalRequests: total, successRate: total > 0 ? successCount / total : 0, avgLatency: avgResult?.avg ?? 0, requestsByType, recentRequests: recentCount };
}

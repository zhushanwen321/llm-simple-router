import Database from "better-sqlite3";
import { randomUUID } from "crypto";

export interface UsageWindow {
  id: string;
  router_key_id: string | null;
  start_time: string;
  end_time: string;
  created_at: string;
}

export interface WindowUsage {
  request_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

export function insertWindow(
  db: Database.Database,
  w: Omit<UsageWindow, "created_at">,
): string {
  const id = w.id || randomUUID();
  db.prepare(
    "INSERT INTO usage_windows (id, router_key_id, start_time, end_time) VALUES (?, ?, ?, ?)",
  ).run(id, w.router_key_id ?? null, w.start_time, w.end_time);
  return id;
}

export function getLatestWindow(
  db: Database.Database,
  routerKeyId?: string,
): UsageWindow | null {
  const sql = routerKeyId
    ? "SELECT * FROM usage_windows WHERE router_key_id = ? ORDER BY start_time DESC LIMIT 1"
    : "SELECT * FROM usage_windows ORDER BY start_time DESC LIMIT 1";
  const params = routerKeyId ? [routerKeyId] : [];
  return db.prepare(sql).get(...params) as UsageWindow | null ?? null;
}

/** 返回与 [start, end) 区间有重叠的窗口 */
export function getWindowsInRange(
  db: Database.Database,
  start: string,
  end: string,
  routerKeyId?: string,
): UsageWindow[] {
  if (routerKeyId) {
    return db.prepare(
      "SELECT * FROM usage_windows WHERE start_time < ? AND end_time > ? AND router_key_id = ? ORDER BY start_time ASC",
    ).all(end, start, routerKeyId) as UsageWindow[];
  }
  return db.prepare(
    "SELECT * FROM usage_windows WHERE start_time < ? AND end_time > ? ORDER BY start_time ASC",
  ).all(end, start) as UsageWindow[];
}

/** 聚合指定时间窗口内的请求计数和 token 用量 */
export function getWindowUsage(
  db: Database.Database,
  startTime: string,
  endTime: string,
  routerKeyId?: string,
): WindowUsage {
  const baseSql = `
    SELECT
      COUNT(*) AS request_count,
      COALESCE(SUM(rm.input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(rm.output_tokens), 0) AS total_output_tokens
    FROM request_metrics rm
    JOIN request_logs rl ON rl.id = rm.request_log_id
    WHERE rm.is_complete = 1
      AND rm.created_at >= datetime(?)
      AND rm.created_at < datetime(?)`;

  if (routerKeyId) {
    return db.prepare(
      `${baseSql} AND rl.router_key_id = ?`,
    ).get(startTime, endTime, routerKeyId) as WindowUsage;
  }
  return db.prepare(baseSql).get(startTime, endTime) as WindowUsage;
}

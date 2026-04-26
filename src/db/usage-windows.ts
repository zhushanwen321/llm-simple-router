import Database from "better-sqlite3";
import { randomUUID } from "crypto";

export interface UsageWindow {
  id: string;
  router_key_id: string | null;
  provider_id: string | null;
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
    "INSERT INTO usage_windows (id, router_key_id, provider_id, start_time, end_time) VALUES (?, ?, ?, ?, ?)",
  ).run(id, w.router_key_id ?? null, w.provider_id ?? null, w.start_time, w.end_time);
  return id;
}

export function getLatestWindow(
  db: Database.Database,
  routerKeyId?: string,
  providerId?: string,
): UsageWindow | null {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (routerKeyId) {
    conditions.push("router_key_id = ?");
    params.push(routerKeyId);
  } else {
    conditions.push("router_key_id IS NULL");
  }
  if (providerId) {
    conditions.push("provider_id = ?");
    params.push(providerId);
  } else {
    conditions.push("provider_id IS NULL");
  }

  const sql = `SELECT * FROM usage_windows WHERE ${conditions.join(" AND ")} ORDER BY start_time DESC LIMIT 1`;
  return db.prepare(sql).get(...params) as UsageWindow | null ?? null;
}

/** 返回与 [start, end) 区间有重叠的窗口 */
export function getWindowsInRange(
  db: Database.Database,
  start: string,
  end: string,
  routerKeyId?: string,
  providerId?: string,
): UsageWindow[] {
  const conditions = ["start_time < ?", "end_time > ?"];
  const params: unknown[] = [end, start];

  if (routerKeyId) {
    conditions.push("router_key_id = ?");
    params.push(routerKeyId);
  }
  if (providerId) {
    conditions.push("provider_id = ?");
    params.push(providerId);
  }

  return db.prepare(
    `SELECT * FROM usage_windows WHERE ${conditions.join(" AND ")} ORDER BY start_time ASC`,
  ).all(...params) as UsageWindow[];
}

/** 聚合指定时间窗口内的请求计数和 token 用量 */
export function getWindowUsage(
  db: Database.Database,
  startTime: string,
  endTime: string,
  routerKeyId?: string,
  providerId?: string,
): WindowUsage {
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

  return db.prepare(`
    SELECT
      COUNT(*) AS request_count,
      COALESCE(SUM(rm.input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(rm.output_tokens), 0) AS total_output_tokens
    FROM request_metrics rm
    WHERE ${conditions.join(" AND ")}
  `).get(...params) as WindowUsage;
}

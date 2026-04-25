import Database from "better-sqlite3";
import { getLatestWindow, insertWindow } from "../db/usage-windows.js";
import { toSqliteDatetime, parseSqliteDatetime } from "./datetime.js";

export type DashboardPeriod = "window" | "weekly" | "monthly";

export interface TimeRange {
  startTime: string;
  endTime: string;
}

// 5 小时窗口，与 usage-windows 的默认窗口时长对齐
const WINDOW_DURATION_MS = 5 * 3600_000;

export function resolveTimeRange(
  period: DashboardPeriod,
  db: Database.Database,
  routerKeyId?: string,
): TimeRange {
  const now = new Date();

  switch (period) {
    case "window": {
      const latest = getLatestWindow(db, routerKeyId);
      if (!latest) {
        return createAndReturnWindow(db, now, routerKeyId);
      }
      // 最新窗口已过期（无请求触发新窗口创建），主动补齐
      if (now > parseSqliteDatetime(latest.end_time)) {
        return createAndReturnWindow(db, now, routerKeyId);
      }
      return { startTime: latest.start_time, endTime: latest.end_time };
    }
    case "weekly": {
      const monday = getMonday(now);
      monday.setHours(0, 0, 0, 0);
      return { startTime: toSqliteDatetime(monday), endTime: toSqliteDatetime(now) };
    }
    case "monthly": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startTime: toSqliteDatetime(first), endTime: toSqliteDatetime(now) };
    }
  }
}

/** 从 date 对象中计算出当周的周一 */
export function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  // 周日 getDay()=0，需要回退到上周一
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

function createAndReturnWindow(
  db: Database.Database,
  now: Date,
  routerKeyId?: string,
): TimeRange {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + WINDOW_DURATION_MS);
  insertWindow(db, {
    id: "",
    router_key_id: routerKeyId ?? null,
    start_time: toSqliteDatetime(start),
    end_time: toSqliteDatetime(end),
  });
  return { startTime: toSqliteDatetime(start), endTime: toSqliteDatetime(end) };
}

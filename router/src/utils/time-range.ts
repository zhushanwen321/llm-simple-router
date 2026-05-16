import Database from "better-sqlite3";
import { getLatestWindow, getLatestWindowByProvider } from "../db/usage-windows.js";
import { toSqliteDatetime, parseSqliteDatetime } from "./datetime.js";
import { getLatestMetricTime } from "../db/stats.js";

export type DashboardPeriod = "window" | "weekly" | "monthly";

export interface TimeRange {
  startTime: string;
  endTime: string;
}

const WINDOW_HOURS = 5;
const MS_PER_HOUR = 3600_000;
const MS_PER_MINUTE = 60000;
const WINDOW_DURATION_MS = WINDOW_HOURS * MS_PER_HOUR;

const DAYS_TO_SUNDAY = 6;
const END_OF_DAY_HOUR = 23;
const END_OF_DAY_MINUTE = 59;
const END_OF_DAY_SECOND = 59;
const END_OF_DAY_MS = 999;

export function resolveTimeRange(
  period: DashboardPeriod,
  db: Database.Database,
  routerKeyId?: string,
  providerId?: string,
): TimeRange {
  const now = new Date();

  switch (period) {
    case "window": {
    // 有 providerId 但无 routerKeyId 时，忽略 router_key_id 查找最新窗口
    // （dashboard 等调用方不知道 router_key_id 时，也能匹配到实际窗口）
      const latest = providerId && !routerKeyId
        ? getLatestWindowByProvider(db, providerId)
        : getLatestWindow(db, routerKeyId, providerId);
      if (latest && now <= parseSqliteDatetime(latest.end_time)) {
        // 有未过期窗口 → 直接使用窗口范围
        return { startTime: latest.start_time, endTime: latest.end_time };
      }
      // 无窗口或窗口已过期 → 从最新 metric 时间前向 5h 生成范围（不写 DB）
      const metricTimeStr = getLatestMetricTime(db, providerId, routerKeyId);
      if (metricTimeStr) {
        const metricTime = parseSqliteDatetime(metricTimeStr);
        // start 向下取整到分钟，end = start + 5h
        const start = new Date(Math.floor(metricTime.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE);
        const end = new Date(start.getTime() + WINDOW_DURATION_MS);
        return { startTime: toSqliteDatetime(start), endTime: toSqliteDatetime(end) };
      }
      // 完全没有数据 → 从当前时间前向
      const fallbackStart = new Date(Math.floor(now.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE);
      const fallbackEnd = new Date(fallbackStart.getTime() + WINDOW_DURATION_MS);
      return { startTime: toSqliteDatetime(fallbackStart), endTime: toSqliteDatetime(fallbackEnd) };
    }
    case "weekly": {
      const monday = getMonday(now);
      monday.setHours(0, 0, 0, 0);
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + DAYS_TO_SUNDAY);
      sunday.setHours(END_OF_DAY_HOUR, END_OF_DAY_MINUTE, END_OF_DAY_SECOND, END_OF_DAY_MS);
      return { startTime: toSqliteDatetime(monday), endTime: toSqliteDatetime(sunday) };
    }
    case "monthly": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      last.setHours(END_OF_DAY_HOUR, END_OF_DAY_MINUTE, END_OF_DAY_SECOND, END_OF_DAY_MS);
      return { startTime: toSqliteDatetime(first), endTime: toSqliteDatetime(last) };
    }
  }
}

/** 从 date 对象中计算出当周的周一 */
export function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const SUNDAY_OFFSET = -6;
  const MONDAY_BASE = 1;
  const diff = d.getDate() - day + (day === 0 ? SUNDAY_OFFSET : MONDAY_BASE);
  d.setDate(diff);
  return d;
}

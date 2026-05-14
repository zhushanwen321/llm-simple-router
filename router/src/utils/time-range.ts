import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import { getLatestWindow, insertWindow } from "../db/usage-windows.js";
import { toSqliteDatetime, parseSqliteDatetime } from "./datetime.js";
import { getLatestMetricTime } from "../db/stats.js";

export type DashboardPeriod = "window" | "weekly" | "monthly";

export interface TimeRange {
  startTime: string;
  endTime: string;
}

const WINDOW_HOURS = 5;
const MS_PER_HOUR = 3600_000;
// 与 usage-windows 的默认窗口时长对齐
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
    const latest = getLatestWindow(db, routerKeyId, providerId);
    if (!latest) {
    return createAndReturnWindow(db, now, routerKeyId, providerId);
    }
    // 最新窗口已过期（无请求触发新窗口创建），基于上一次窗口结束时间补齐
    if (now > parseSqliteDatetime(latest.end_time)) {
    return createAndReturnWindow(db, now, routerKeyId, providerId, parseSqliteDatetime(latest.end_time));
    }
    return { startTime: latest.start_time, endTime: latest.end_time };
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
  // 周日 getDay()=0，需要回退到上周一；+1 将周日=0 映射到周一=1 基准
  const SUNDAY_OFFSET = -6;
  const MONDAY_BASE = 1;
  const diff = d.getDate() - day + (day === 0 ? SUNDAY_OFFSET : MONDAY_BASE);
  d.setDate(diff);
  return d;
}

function createAndReturnWindow(
  db: Database.Database,
  now: Date,
  routerKeyId?: string,
  providerId?: string,
  previousEndTime?: Date,
): TimeRange {
  // 优先从上一次窗口结束时间接续，避免窗口之间出现间隙
  let start: Date;
  if (previousEndTime) {
  start = previousEndTime;
  } else {
  // 没有历史窗口时，基于最近一条 metric 的时间回溯 5h
  const latestMetric = getLatestMetricTime(db, providerId, routerKeyId);
  if (latestMetric) {
    const metricTime = parseSqliteDatetime(latestMetric);
    // 回溯一个窗口长度，覆盖最近的数据
    start = new Date(Math.max(
    metricTime.getTime() - WINDOW_DURATION_MS,
    truncateToHour(now).getTime() - WINDOW_DURATION_MS,
    ));
    start = truncateToHour(start);
  } else {
    start = truncateToHour(now);
  }
  }
  const end = new Date(start.getTime() + WINDOW_DURATION_MS);
  insertWindow(db, {
  id: randomUUID(),
  router_key_id: routerKeyId ?? null,
  provider_id: providerId ?? null,
  start_time: toSqliteDatetime(start),
  end_time: toSqliteDatetime(end),
  });
  return { startTime: toSqliteDatetime(start), endTime: toSqliteDatetime(end) };
}

function truncateToHour(date: Date): Date {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d;
}

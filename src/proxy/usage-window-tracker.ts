import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { getLatestWindow, insertWindow } from "../db/usage-windows.js";

// eslint-disable-next-line no-magic-numbers
const WINDOW_DURATION_MS = 5 * 3600_000;

export class UsageWindowTracker {
  constructor(private db: Database.Database) {}

  /** 请求成功后调用，按需创建新窗口 */
  recordRequest(routerKeyId?: string): void {
    const now = new Date();
    const latest = getLatestWindow(this.db, routerKeyId);
    if (!latest || now > parseDate(latest.end_time)) {
      const startTime = truncateToMinute(now);
      insertWindow(this.db, {
        id: randomUUID(),
        router_key_id: routerKeyId ?? null,
        start_time: toSqliteDatetime(startTime),
        end_time: toSqliteDatetime(new Date(startTime.getTime() + WINDOW_DURATION_MS)),
      });
    }
  }

  /** 启动时补齐因宕机/重启而缺失的窗口 */
  reconcileOnStartup(): void {
    const latest = getLatestWindow(this.db);

    // 查找 request_logs 中最新一条请求的时间
    const lastLog = this.db.prepare(
      "SELECT created_at FROM request_logs ORDER BY created_at DESC LIMIT 1",
    ).get() as { created_at: string } | undefined;

    if (!lastLog) return;

    if (!latest) {
      // 从未创建过窗口，但有请求记录，从最早请求创建初始窗口
      const firstLog = this.db.prepare(
        "SELECT created_at FROM request_logs ORDER BY created_at ASC LIMIT 1",
      ).get() as { created_at: string } | undefined;
      if (!firstLog) return;

      const start = parseDate(firstLog.created_at);
      const truncated = truncateToMinute(start);
      insertWindow(this.db, {
        id: randomUUID(),
        router_key_id: null,
        start_time: toSqliteDatetime(truncated),
        end_time: toSqliteDatetime(new Date(truncated.getTime() + WINDOW_DURATION_MS)),
      });

      // 继续补齐后续窗口
      this.backfillWindows(truncated);
      return;
    }

    // 有窗口，检查 end_time 之后是否有请求
    this.backfillWindows(parseDate(latest.end_time));
  }

  /** 从 baseTime 开始，每 5h 一个窗口，直到覆盖 lastLogTime */
  private backfillWindows(baseTime: Date): void {
    const lastLog = this.db.prepare(
      "SELECT created_at FROM request_logs ORDER BY created_at DESC LIMIT 1",
    ).get() as { created_at: string } | undefined;
    if (!lastLog) return;

    const lastLogTime = parseDate(lastLog.created_at);
    let windowStart = baseTime;

    while (windowStart < lastLogTime) {
      const windowEnd = new Date(windowStart.getTime() + WINDOW_DURATION_MS);
      insertWindow(this.db, {
        id: randomUUID(),
        router_key_id: null,
        start_time: toSqliteDatetime(windowStart),
        end_time: toSqliteDatetime(windowEnd),
      });
      windowStart = windowEnd;
    }
  }
}

function truncateToMinute(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d;
}

/** Date → SQLite datetime 格式 (YYYY-MM-DD HH:MM:SS) */
function toSqliteDatetime(date: Date): string {
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

/** 兼容 ISO 和 SQLite datetime 格式的日期解析 */
function parseDate(s: string): Date {
  // ISO 格式已包含时区信息，直接解析
  if (s.includes("T")) return new Date(s);
  // SQLite datetime 格式 (YYYY-MM-DD HH:MM:SS) 视为 UTC
  return new Date(s + "Z");
}

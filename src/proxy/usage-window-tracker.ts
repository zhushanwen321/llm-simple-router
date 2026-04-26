import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { getLatestWindow, insertWindow } from "../db/usage-windows.js";
import { toSqliteDatetime, parseSqliteDatetime as parseDate } from "../utils/datetime.js";

// eslint-disable-next-line no-magic-numbers
const WINDOW_DURATION_MS = 5 * 3600_000;

export class UsageWindowTracker {
  constructor(private db: Database.Database) {}

  /** 请求成功后调用，按需创建新窗口 */
  recordRequest(providerId: string, routerKeyId?: string): void {
    const now = new Date();
    const latest = getLatestWindow(this.db, routerKeyId, providerId);
    if (!latest || now > parseDate(latest.end_time)) {
      const startTime = truncateToMinute(now);
      insertWindow(this.db, {
        id: randomUUID(),
        router_key_id: routerKeyId ?? null,
        provider_id: providerId,
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
        provider_id: null,
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
        provider_id: null,
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

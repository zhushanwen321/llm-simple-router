import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { getLatestWindow, insertWindow } from "../db/usage-windows.js";
import { getAllProviders } from "../db/providers.js";
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

  /** 启动时按活跃 provider 补齐缺失的窗口 */
  reconcileOnStartup(): void {
    const providers = getAllProviders(this.db).filter((p) => p.is_active);
    for (const provider of providers) {
      this.reconcileProvider(provider.id);
    }
  }

  /** 为单个 provider 补齐窗口 */
  private reconcileProvider(providerId: string): void {
    const latest = getLatestWindow(this.db, undefined, providerId);

    const lastLog = this.db.prepare(
      "SELECT created_at FROM request_logs WHERE provider_id = ? ORDER BY created_at DESC LIMIT 1",
    ).get(providerId) as { created_at: string } | undefined;
    if (!lastLog) return;

    if (!latest) {
      const firstLog = this.db.prepare(
        "SELECT created_at FROM request_logs WHERE provider_id = ? ORDER BY created_at ASC LIMIT 1",
      ).get(providerId) as { created_at: string } | undefined;
      if (!firstLog) return;

      const truncated = truncateToMinute(parseDate(firstLog.created_at));
      this.backfillProviderWindows(providerId, truncated);
      return;
    }

    this.backfillProviderWindows(providerId, parseDate(latest.end_time));
  }

  /** 从 baseTime 开始，每 5h 一个窗口，直到覆盖 lastLogTime */
  private backfillProviderWindows(providerId: string, baseTime: Date): void {
    const lastLog = this.db.prepare(
      "SELECT created_at FROM request_logs WHERE provider_id = ? ORDER BY created_at DESC LIMIT 1",
    ).get(providerId) as { created_at: string } | undefined;
    if (!lastLog) return;

    const lastLogTime = parseDate(lastLog.created_at);
    let windowStart = baseTime;

    while (windowStart < lastLogTime) {
      const windowEnd = new Date(windowStart.getTime() + WINDOW_DURATION_MS);
      insertWindow(this.db, {
        id: randomUUID(),
        router_key_id: null,
        provider_id: providerId,
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

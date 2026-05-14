import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { getLatestWindow, insertWindow } from "../../db/usage-windows.js";
import { getAllProviders } from "../../db/providers.js";
import { toSqliteDatetime, parseSqliteDatetime as parseDate } from "../../utils/datetime.js";

// eslint-disable-next-line no-magic-numbers
const WINDOW_DURATION_MS = 5 * 3600_000;
// 过期判断最小间隔（毫秒），同分钟内不重复创建窗口
const WINDOW_GRACE_PERIOD_MS = 60000;

export class UsageWindowTracker {
  constructor(private db: Database.Database) {}

  /** 请求成功后调用，按需创建新窗口（回溯模式：窗口 = [now - 5h, now]） */
  recordRequest(providerId: string, routerKeyId?: string): void {
    const now = new Date();
    const latest = getLatestWindow(this.db, routerKeyId, providerId);
    // 无窗口 → 创建。有窗口且跨分钟（>=60s 差距）→ 新窗口。
    // 同分钟内的快速调用不重复创建，避免同一分钟内的多次请求产生多个窗口。
    if (!latest) {
      createBackwardWindow(this.db, now, routerKeyId, providerId);
    } else if (now.getTime() - parseDate(latest.end_time).getTime() >= WINDOW_GRACE_PERIOD_MS) {
      createBackwardWindow(this.db, now, routerKeyId, providerId);
    }
  }

  /** 启动时按活跃 provider 补齐缺失的窗口（每个 provider 仅创建一个回溯窗口） */
  reconcileOnStartup(): void {
    const providers = getAllProviders(this.db).filter((p) => p.is_active);
    for (const provider of providers) {
      this.reconcileProvider(provider.id);
    }
  }

  /** 为单个 provider 补齐窗口：无窗口时基于最新 log 创建回溯窗口 */
  private reconcileProvider(providerId: string): void {
    const latest = getLatestWindow(this.db, undefined, providerId);
    if (latest) return;

    const lastLog = this.db.prepare(
      "SELECT created_at FROM request_logs WHERE provider_id = ? ORDER BY created_at DESC LIMIT 1",
    ).get(providerId) as { created_at: string } | undefined;
    if (!lastLog) return;

    const end = truncateToMinute(parseDate(lastLog.created_at));
    createBackwardWindow(this.db, end, undefined, providerId);
  }
}

/** 创建 5h 回溯窗口：窗口 = [end - 5h, end] */
function createBackwardWindow(
  db: Database.Database,
  end: Date,
  routerKeyId?: string,
  providerId?: string,
): void {
  const endMinute = truncateToMinute(end);
  const start = new Date(endMinute.getTime() - WINDOW_DURATION_MS);
  insertWindow(db, {
    id: randomUUID(),
    router_key_id: routerKeyId ?? null,
    provider_id: providerId ?? null,
    start_time: toSqliteDatetime(start),
    end_time: toSqliteDatetime(endMinute),
  });
}

function truncateToMinute(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d;
}

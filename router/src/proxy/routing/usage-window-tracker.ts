import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { getLatestWindow, insertWindow } from "../../db/usage-windows.js";
import { getAllProviders } from "../../db/providers.js";
import { toSqliteDatetime, parseSqliteDatetime as parseDate } from "../../utils/datetime.js";

// eslint-disable-next-line no-magic-numbers
const WINDOW_DURATION_MS = 5 * 3600_000;
const MS_PER_MINUTE = 60000;
// 过期判断最小间隔（毫秒），同分钟内不重复创建窗口
const WINDOW_GRACE_PERIOD_MS = MS_PER_MINUTE;

export class UsageWindowTracker {
  constructor(private db: Database.Database) {}

  /** 请求成功后调用，按需创建新窗口（前向模式：窗口 = [now, now + 5h]） */
  recordRequest(providerId: string, routerKeyId?: string): void {
    const now = new Date();
    const latest = getLatestWindow(this.db, routerKeyId, providerId);
    // 无窗口 → 创建。有窗口但已过期（end_time <= now）且跨分钟 → 新窗口。
    // 同分钟内的快速调用不重复创建，避免同一分钟内的多次请求产生多个窗口。
    if (!latest) {
      createForwardWindow(this.db, now, routerKeyId, providerId);
    } else if (parseDate(latest.end_time) <= now
    && now.getTime() - parseDate(latest.end_time).getTime() >= WINDOW_GRACE_PERIOD_MS) {
      createForwardWindow(this.db, now, routerKeyId, providerId);
    }
  }

  /** 启动时按活跃 provider 补齐缺失的窗口（每个 provider 仅创建一个前向窗口） */
  reconcileOnStartup(): void {
    const providers = getAllProviders(this.db).filter((p) => p.is_active);
    for (const provider of providers) {
      this.reconcileProvider(provider.id);
    }
  }

  /** 为单个 provider 补齐窗口：无窗口时基于最新 log 创建前向窗口 */
  private reconcileProvider(providerId: string): void {
    const latest = getLatestWindow(this.db, undefined, providerId);
    if (latest) return;

    const lastLog = this.db.prepare(
      "SELECT created_at FROM request_logs WHERE provider_id = ? ORDER BY created_at DESC LIMIT 1",
    ).get(providerId) as { created_at: string } | undefined;
    if (!lastLog) return;

    const anchor = parseDate(lastLog.created_at);
    createForwardWindow(this.db, anchor, undefined, providerId);
  }
}

/** 创建 5h 前向窗口：窗口 = [start, start + 5h]，start 向下取整到分钟 */
function createForwardWindow(
  db: Database.Database,
  anchor: Date,
  routerKeyId?: string,
  providerId?: string,
): void {
  const start = new Date(Math.floor(anchor.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE);
  const end = new Date(start.getTime() + WINDOW_DURATION_MS);
  insertWindow(db, {
    id: randomUUID(),
    router_key_id: routerKeyId ?? null,
    provider_id: providerId ?? null,
    start_time: toSqliteDatetime(start),
    end_time: toSqliteDatetime(end),
  });
}

import Database from "better-sqlite3";
import { deleteLogsBefore } from "./logs.js";
import { getLogRetentionDays } from "./settings.js";
import { deleteToolErrorLogsBefore } from "./tool-error-logs.js";

const MS_PER_DAY = 86_400_000;
const CLEANUP_INTERVAL_MS = 3_600_000; // 1 小时

export interface LogCleanupHandle {
  stop: () => void;
}

/** 运行一次清理，返回删除条数 */
export function runLogCleanup(db: Database.Database): number {
  const days = getLogRetentionDays(db);
  if (days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * MS_PER_DAY).toISOString();
  const logDeleted = deleteLogsBefore(db, cutoff);
  const toolErrorDeleted = deleteToolErrorLogsBefore(db, cutoff);
  return logDeleted + toolErrorDeleted;
}

/** 启动定时清理，返回 handle 用于停止 */
export function scheduleLogCleanup(
  db: Database.Database,
  log: { info: (msg: string) => void },
): LogCleanupHandle {
  let cleaning = false;
  let initialTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;

  const doCleanup = () => {
    if (cleaning) return;
    cleaning = true;
    try {
      const deleted = runLogCleanup(db);
      if (deleted > 0) log.info(`Log cleanup: deleted ${deleted} records`);
    } catch (e) {
      // DB 可能已关闭（测试清理、进程关闭等）
      log.info(`Log cleanup skipped: ${e instanceof Error ? e.message : e instanceof Error ? e.message : JSON.stringify(e)}`);
    } finally {
      cleaning = false;
    }
  };

  // 推迟到下一个事件循环 tick，避免阻塞服务器启动
  initialTimer = setTimeout(doCleanup, 0);

  // 定时执行
  intervalTimer = setInterval(doCleanup, CLEANUP_INTERVAL_MS);

  return {
    stop: () => {
      if (initialTimer) { clearTimeout(initialTimer); initialTimer = null; }
      if (intervalTimer) { clearInterval(intervalTimer); intervalTimer = null; }
    },
  };
}

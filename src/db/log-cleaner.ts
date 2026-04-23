import Database from "better-sqlite3";
import { deleteLogsBefore } from "./logs.js";
import { getLogRetentionDays } from "./settings.js";

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
  return deleteLogsBefore(db, cutoff);
}

/** 启动定时清理，返回 handle 用于停止 */
export function scheduleLogCleanup(
  db: Database.Database,
  log: { info: (msg: string) => void },
): LogCleanupHandle {
  let cleaning = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const doCleanup = () => {
    if (cleaning) return;
    cleaning = true;
    try {
      const deleted = runLogCleanup(db);
      if (deleted > 0) log.info(`Log cleanup: deleted ${deleted} records`);
    } finally {
      cleaning = false;
    }
  };

  // 启动时立即执行一次
  doCleanup();

  // 定时执行
  timer = setInterval(doCleanup, CLEANUP_INTERVAL_MS);

  return {
    stop: () => {
      if (timer) { clearInterval(timer); timer = null; }
    },
  };
}

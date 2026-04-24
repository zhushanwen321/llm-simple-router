import { statSync } from "fs";
import Database from "better-sqlite3";
import { setSetting, getDbMaxSizeMb, getLogTableMaxSizeMb } from "./settings.js";
import { estimateLogTableSize, deleteOldestLogs, getLogCount } from "./logs.js";

const BYTES_PER_MB = 1_048_576;
const DEFAULT_INTERVAL_MS = 1_800_000; // 30 分钟
const CLEANUP_TARGET_RATIO = 0.8;
const DEFAULT_ROW_BYTES = 500;

export interface DbSizeInfo {
  totalBytes: number;
  logTableBytes: number;
  logCount: number;
  lastChecked: string;
}

export interface SizeThresholds {
  dbMaxSizeMb: number;
  logTableMaxSizeMb: number;
}

export function collectDbSizeInfo(db: Database.Database, dbPath: string): DbSizeInfo {
  let totalBytes = 0;
  if (dbPath !== ":memory:") {
    try {
      totalBytes = statSync(dbPath).size;
    } catch { // eslint-disable-line taste/no-silent-catch -- DB 文件可能尚未创建（CI 内存测试、首次启动等）
    }
  }
  const logTableBytes = estimateLogTableSize(db);
  const logCount = getLogCount(db);
  const info: DbSizeInfo = {
    totalBytes,
    logTableBytes,
    logCount,
    lastChecked: new Date().toISOString(),
  };
  setSetting(db, "db_size_info", JSON.stringify(info));
  return info;
}

export function runSizeBasedCleanup(
  db: Database.Database,
  dbPath: string,
  thresholds: SizeThresholds,
): number {
  const info = collectDbSizeInfo(db, dbPath);
  const logOverThreshold = info.logTableBytes > thresholds.logTableMaxSizeMb * BYTES_PER_MB;
  const dbOverThreshold = info.totalBytes > thresholds.dbMaxSizeMb * BYTES_PER_MB;

  if (!logOverThreshold && !dbOverThreshold) return 0;

  const targetBytes = thresholds.logTableMaxSizeMb * BYTES_PER_MB * CLEANUP_TARGET_RATIO;
  const avgRowBytes = info.logCount > 0 ? info.logTableBytes / info.logCount : DEFAULT_ROW_BYTES;
  const keepCount = Math.max(0, Math.floor(targetBytes / avgRowBytes));

  return deleteOldestLogs(db, keepCount);
}

export interface DbSizeMonitorHandle {
  stop: () => void;
}

export function scheduleDbSizeMonitor(
  db: Database.Database,
  dbPath: string,
  options: {
    intervalMs?: number;
    log: { info: (msg: string) => void };
  },
): DbSizeMonitorHandle {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let running = false;
  let initialTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;

  const doCheck = () => {
    if (running) return;
    running = true;
    try {
      // 每次检查时从 DB 读取最新阈值，而非使用启动时的缓存值
      const thresholds: SizeThresholds = {
        dbMaxSizeMb: getDbMaxSizeMb(db),
        logTableMaxSizeMb: getLogTableMaxSizeMb(db),
      };
      const deleted = runSizeBasedCleanup(db, dbPath, thresholds);
      if (deleted > 0) options.log.info(`Size-based cleanup: deleted ${deleted} log records`);
    } catch (e) {
      // DB 可能已关闭（测试清理、进程关闭等）
      options.log.info(`Size monitor check skipped: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
  };

  // 推迟到下一个事件循环 tick，避免阻塞服务器启动（与 log-cleaner 保持一致）
  initialTimer = setTimeout(doCheck, 0);

  intervalTimer = setInterval(doCheck, intervalMs);
  return {
    stop: () => {
      if (initialTimer) { clearTimeout(initialTimer); initialTimer = null; }
      if (intervalTimer) { clearInterval(intervalTimer); intervalTimer = null; }
    },
  };
}

import { readdirSync, readFileSync, writeFileSync, unlinkSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { WINDOW_MINUTES, TIME_PAD_WIDTH, localDateStr } from "./types.js";

const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const COMPRESSION_INTERVAL_MS = WINDOW_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;

/** 将已结束窗口的 .jsonl 文件压缩为 .jsonl.gz */
export function compressFinishedFiles(baseDir: string, now: Date): number {
  let compressed = 0;
  if (!existsSync(baseDir)) return 0;

  const dayDirs = readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name));

  for (const dayDir of dayDirs) {
    const dirPath = join(baseDir, dayDir.name);
    const files = readdirSync(dirPath);

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;

      const match = file.match(/^(\d{2})-(\d{2})\.jsonl$/);
      if (!match) continue;

      const fileHour = parseInt(match[1], 10);
      const fileMinute = parseInt(match[2], 10);

      // 使用 UTC 时间构建窗口结束时间
      const dateParts = dayDir.name.split("-").map(Number);
      const windowEnd = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2], fileHour, fileMinute + WINDOW_MINUTES));

      if (now >= windowEnd) {
        const filePath = join(dirPath, file);
        try {
          const content = readFileSync(filePath);
          const gzipped = gzipSync(content);
          writeFileSync(filePath + ".gz", gzipped);
          unlinkSync(filePath);
          compressed++;
        // eslint-disable-next-line taste/no-silent-catch
        } catch {
          // 文件可能正在被写入，跳过
        }
      }
    }
  }
  return compressed;
}

/** 删除超过保留天数的日期目录 */
export function cleanExpiredDirs(baseDir: string, retentionDays: number, now: Date): number {
  if (!existsSync(baseDir)) return 0;

  const cutoffStr = localDateStr(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - retentionDays)));

  let deleted = 0;
  const dayDirs = readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name));

  for (const dayDir of dayDirs) {
    if (dayDir.name <= cutoffStr) {
      rmSync(join(baseDir, dayDir.name), { recursive: true, force: true });
      deleted++;
    }
  }
  return deleted;
}

export interface LogFileMaintenanceHandle {
  stop: () => void;
}

/** 启动定时维护任务：每 10 分钟执行压缩 + 清理 */
export function scheduleLogFileMaintenance(
  baseDir: string,
  options: {
    retentionDays: number;
    log: { info: (msg: string) => void };
    intervalMs?: number;
  },
): LogFileMaintenanceHandle {
  const intervalMs = options.intervalMs ?? COMPRESSION_INTERVAL_MS;

  const doMaintenance = () => {
    const now = new Date();
    const compressed = compressFinishedFiles(baseDir, now);
    const deleted = cleanExpiredDirs(baseDir, options.retentionDays, now);
    if (compressed > 0 || deleted > 0) {
      options.log.info(`Log file maintenance: compressed ${compressed} files, deleted ${deleted} dirs`);
    }
  };

  const timer = setInterval(doMaintenance, intervalMs);
  const initialTimer = setTimeout(doMaintenance, 0);

  return {
    stop: () => {
      clearInterval(timer);
      clearTimeout(initialTimer);
    },
  };
}

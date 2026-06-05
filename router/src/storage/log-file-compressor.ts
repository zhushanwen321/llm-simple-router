import { readdirSync, readFileSync, writeFileSync, unlinkSync, rmSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { localDateStr } from "./types.js";

const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const COMPRESSION_INTERVAL_MINUTES = 10;
const COMPRESSION_INTERVAL_MS = COMPRESSION_INTERVAL_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;

/** 压缩新格式：遍历 {date}/{HH}/*.json，mtime 超过 10 分钟的压缩为 .json.gz */
function compressNewFormatFiles(baseDir: string, now: Date): number {
  let compressed = 0;
  if (!existsSync(baseDir)) return 0;

  const dayDirs = readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name));

  for (const dayDir of dayDirs) {
    const dayPath = join(baseDir, dayDir.name);
    const hourDirs = readdirSync(dayPath, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^\d{2}$/.test(d.name));

    for (const hourDir of hourDirs) {
      const hourPath = join(dayPath, hourDir.name);
      const files = readdirSync(hourPath);

      for (const file of files) {
        if (!file.endsWith(".json") || file.endsWith(".json.gz")) continue;

        const filePath = join(hourPath, file);
        try {
          const stat = statSync(filePath);
          if (now.getTime() - stat.mtimeMs > COMPRESSION_INTERVAL_MS) {
            const content = readFileSync(filePath);
            writeFileSync(filePath + ".gz", gzipSync(content));
            unlinkSync(filePath);
            compressed++;
          }
        } catch {
          /* 新格式文件可能正在被写入，跳过 */
          continue;
        }
      }
    }
  }
  return compressed;
}

/** 压缩旧格式：将已结束窗口的 .jsonl 文件压缩为 .jsonl.gz */
function compressLegacyJsonlFiles(baseDir: string, now: Date): number {
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
      const windowEnd = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2], fileHour, fileMinute + COMPRESSION_INTERVAL_MINUTES));

      if (now >= windowEnd) {
        const filePath = join(dirPath, file);
        try {
          const content = readFileSync(filePath);
          writeFileSync(filePath + ".gz", gzipSync(content));
          unlinkSync(filePath);
          compressed++;
        } catch {
          /* 旧格式文件可能正在被写入，跳过 */
          continue;
        }
      }
    }
  }
  return compressed;
}

/** 压缩所有已结束的文件（新格式 + 旧格式）。对外接口，供测试和维护调用 */
export function compressFinishedFiles(baseDir: string, now: Date): number {
  return compressNewFormatFiles(baseDir, now) + compressLegacyJsonlFiles(baseDir, now);
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
    const newCompressed = compressNewFormatFiles(baseDir, now);
    const legacyCompressed = compressLegacyJsonlFiles(baseDir, now);
    const deleted = cleanExpiredDirs(baseDir, options.retentionDays, now);
    const totalCompressed = newCompressed + legacyCompressed;
    if (totalCompressed > 0 || deleted > 0) {
      options.log.info(`Log file maintenance: compressed ${totalCompressed} files (${newCompressed} new + ${legacyCompressed} legacy), deleted ${deleted} dirs`);
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

import { createWriteStream, mkdirSync, existsSync, readFileSync } from "node:fs";
import type { WriteStream } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { type LogFileEntry, WINDOW_MINUTES, TIME_PAD_WIDTH, localDateStr } from "./types.js";

/** 从日期对象生成 UTC 时区的日志文件路径片段 */
function localFilePathParts(d: Date): { dateStr: string; fileName: string } {
  const dateStr = localDateStr(d);
  const hour = d.getUTCHours().toString().padStart(TIME_PAD_WIDTH, "0");
  const minute = Math.floor(d.getUTCMinutes() / WINDOW_MINUTES) * WINDOW_MINUTES;
  const minuteStr = minute.toString().padStart(TIME_PAD_WIDTH, "0");
  return { dateStr, fileName: `${hour}-${minuteStr}.jsonl` };
}

export interface LogFileWriterOptions {
  enabled?: boolean;
}

const FLUSH_TIMEOUT_MS = 2000;

export class LogFileWriter {
  private readonly baseDir: string;
  private readonly enabled: boolean;
  private readonly streams = new Map<string, WriteStream>();

  constructor(baseDir: string, options?: LogFileWriterOptions) {
    this.baseDir = baseDir;
    this.enabled = options?.enabled ?? true;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  private getOrCreateStream(filePath: string): WriteStream | null {
    let stream = this.streams.get(filePath);
    if (!stream || stream.destroyed) {
      try {
        stream = createWriteStream(filePath, { flags: "a", encoding: "utf-8" });
        this.streams.set(filePath, stream);
      } catch {
        return null;
      }
    }
    return stream;
  }

  write(entry: LogFileEntry): void {
    if (!this.enabled) return;

    const { dateStr, fileName } = localFilePathParts(new Date(entry.created_at));

    const dayDir = join(this.baseDir, dateStr);
    if (!existsSync(dayDir)) {
      mkdirSync(dayDir, { recursive: true });
    }

    const filePath = join(dayDir, fileName);
    const line = JSON.stringify(entry) + "\n";

    try {
      const stream = this.getOrCreateStream(filePath);
      stream?.write(line);
    // eslint-disable-next-line taste/no-silent-catch
    } catch {
      // 文件写入是辅助通道，失败不影响主流程
    }
  }

  /**
   * 根据 id 和 created_at 从 JSONL 文件回读完整记录。
   * 先尝试未压缩的 .jsonl，再尝试 .jsonl.gz。
   * 返回 null 表示找不到。
   */
  read(id: string, createdAt: string): LogFileEntry | null {
    if (!this.enabled) return null;

    const { dateStr, fileName } = localFilePathParts(new Date(createdAt));
    const dayDir = join(this.baseDir, dateStr);

    // 尝试未压缩文件
    const filePath = join(dayDir, fileName);
    if (existsSync(filePath)) {
      return this.findByIdInFile(filePath, id);
    }

    // 尝试压缩文件
    const gzPath = filePath + ".gz";
    if (existsSync(gzPath)) {
      return this.findByIdInGzFile(gzPath, id);
    }

    return null;
  }

  private findByIdInFile(filePath: string, id: string): LogFileEntry | null {
    try {
      const content = readFileSync(filePath, "utf-8");
      return this.parseAndFind(content, id);
    } catch {
      return null;
    }
  }

  private findByIdInGzFile(gzPath: string, id: string): LogFileEntry | null {
    try {
      const compressed = readFileSync(gzPath);
      const content = gunzipSync(compressed).toString("utf-8");
      return this.parseAndFind(content, id);
    } catch {
      return null;
    }
  }

  private parseAndFind(content: string, id: string): LogFileEntry | null {
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as LogFileEntry;
        if (entry.id === id) return entry;
      // eslint-disable-next-line taste/no-silent-catch
      } catch {
        // 跳过损坏行
      }
    }
    return null;
  }

  /**
   * 关闭所有 WriteStream 并等待数据刷盘。
   * 返回 Promise 以便调用方 await 确保数据落盘。
   * 不 await 调用也是安全的（仅可能丢失最后的缓冲数据）。
   */
  stop(): Promise<void> {
    if (this.streams.size === 0) return Promise.resolve();
    const pending: Promise<void>[] = [];
    for (const [, stream] of this.streams) {
      if (stream.destroyed) continue;
      pending.push(new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, FLUSH_TIMEOUT_MS);
        stream.once("finish", () => { clearTimeout(timer); resolve(); });
        stream.once("error", () => { clearTimeout(timer); resolve(); });
      }));
      try { stream.end(); } catch { /* stream 可能已关闭 */ } // eslint-disable-line taste/no-silent-catch
    }
    this.streams.clear();
    return Promise.allSettled(pending).then(() => { /* void */ });
  }
}

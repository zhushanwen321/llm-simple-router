import { appendFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { type LogFileEntry, LOG_WINDOW_MINUTES } from "./types.js";

export interface LogFileWriterOptions {
  enabled?: boolean;
}

export class LogFileWriter {
  private readonly baseDir: string;
  private readonly enabled: boolean;

  constructor(baseDir: string, options?: LogFileWriterOptions) {
    this.baseDir = baseDir;
    this.enabled = options?.enabled ?? true;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  write(entry: LogFileEntry): void {
    if (!this.enabled) return;

    const date = new Date(entry.created_at);
    const dateStr = date.toISOString().slice(0, 10);
    const hour = date.getUTCHours().toString().padStart(2, "0");
    const minute = Math.floor(date.getUTCMinutes() / LOG_WINDOW_MINUTES) * LOG_WINDOW_MINUTES;
    const minuteStr = minute.toString().padStart(2, "0");
    const fileName = `${hour}-${minuteStr}.jsonl`;

    const dayDir = join(this.baseDir, dateStr);
    if (!existsSync(dayDir)) {
      mkdirSync(dayDir, { recursive: true });
    }

    const filePath = join(dayDir, fileName);
    const line = JSON.stringify(entry) + "\n";

    try {
      appendFileSync(filePath, line, "utf-8");
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

    const date = new Date(createdAt);
    const dateStr = date.toISOString().slice(0, 10);
    const hour = date.getUTCHours().toString().padStart(2, "0");
    const minute = Math.floor(date.getUTCMinutes() / LOG_WINDOW_MINUTES) * LOG_WINDOW_MINUTES;
    const minuteStr = minute.toString().padStart(2, "0");
    const fileName = `${hour}-${minuteStr}.jsonl`;
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
      } catch {
        // 跳过损坏行
      }
    }
    return null;
  }

  stop(): void {
    // 当前实现无需清理
  }
}

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { LogFileEntry } from "./types.js";

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
    const minute = Math.floor(date.getUTCMinutes() / 10) * 10;
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

  stop(): void {
    // 当前实现无需清理
  }
}

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import * as fs from "node:fs/promises";
import { type LogFileEntry, localDateStr } from "./types.js";

/** 数值补零宽度 */
const PAD_WIDTH = 2;
/** 旧 JSONL 格式的窗口分钟数 */
const LEGACY_WINDOW_MINUTES = 10;

/** 从日期对象生成新格式路径片段：{date}/{HH}/{id}.json */
function newFilePathParts(d: Date, id: string): { dateStr: string; hourDir: string; fileName: string } {
  const dateStr = localDateStr(d);
  const hour = d.getUTCHours().toString().padStart(PAD_WIDTH, "0");
  return { dateStr, hourDir: join(dateStr, hour), fileName: `${id}.json` };
}

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

  /**
   * 写入单条日志文件。异步 fire-and-forget 模式：
   * 不阻塞事件循环，失败不影响主流程。
   */
  write(entry: LogFileEntry): void {
    if (!this.enabled) return;

    const { hourDir, fileName } = newFilePathParts(new Date(entry.created_at), entry.id);
    const filePath = join(this.baseDir, hourDir, fileName);

    // 异步写入（fire-and-forget），不阻塞事件循环
    fs.mkdir(dirname(filePath), { recursive: true })
      .then(() => fs.writeFile(filePath, JSON.stringify(entry)))
      .catch(() => {
        /* 文件写入是辅助通道，失败不影响主流程 */
      });
  }

  /**
   * 根据 id 和 created_at 读取完整记录。
   * Fallback 链：
   * 1. {date}/{HH}/{id}.json        → O(1) 直接命中
   * 2. {date}/{HH}/{id}.json.gz     → O(1) 解压单文件
   * 3. {date}/{HH-MM}.jsonl         → 旧格式线性扫描（精确窗口）
   * 4. {date}/{HH-MM}.jsonl.gz      → 旧格式压缩线性扫描
   */
  read(id: string, createdAt: string): LogFileEntry | null {
    if (!this.enabled) return null;

    const d = new Date(createdAt);

    // 新格式路径
    const { dateStr, hourDir } = newFilePathParts(d, id);
    const hourPath = join(this.baseDir, hourDir);

    // 1. 尝试未压缩单条文件
    const jsonPath = join(hourPath, `${id}.json`);
    if (existsSync(jsonPath)) {
      return this.readSingleJsonFile(jsonPath);
    }

    // 2. 尝试压缩单条文件
    const gzPath = jsonPath + ".gz";
    if (existsSync(gzPath)) {
      return this.readSingleGzFile(gzPath);
    }

    // 3-4. 旧格式 fallback：扫描 JSONL 文件
    return this.readFromLegacyJsonl(dateStr, d, id);
  }

  private readSingleJsonFile(filePath: string): LogFileEntry | null {
    try {
      const content = readFileSync(filePath, "utf-8");
      return JSON.parse(content) as LogFileEntry;
    } catch {
      /* 文件读取失败返回 null */
      return null;
    }
  }

  private readSingleGzFile(gzPath: string): LogFileEntry | null {
    try {
      const compressed = readFileSync(gzPath);
      const content = gunzipSync(compressed).toString("utf-8");
      return JSON.parse(content) as LogFileEntry;
    } catch {
      /* 解压或解析失败返回 null */
      return null;
    }
  }

  /**
   * 旧格式 JSONL 回退读取。
   * 根据 created_at 精确计算所在 10 分钟窗口，只扫描 1 个文件。
   */
  private readFromLegacyJsonl(dateStr: string, d: Date, id: string): LogFileEntry | null {
    const dayDir = join(this.baseDir, dateStr);
    const hour = d.getUTCHours().toString().padStart(PAD_WIDTH, "0");
    const minute = Math.floor(d.getUTCMinutes() / LEGACY_WINDOW_MINUTES) * LEGACY_WINDOW_MINUTES;
    const fileName = `${hour}-${minute.toString().padStart(PAD_WIDTH, "0")}.jsonl`;

    // 尝试未压缩 JSONL
    const filePath = join(dayDir, fileName);
    if (existsSync(filePath)) {
      const result = this.findByIdInFile(filePath, id);
      if (result) return result;
    }

    // 尝试压缩 JSONL
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
      /* 文件读取失败返回 null */
      return null;
    }
  }

  private findByIdInGzFile(gzPath: string, id: string): LogFileEntry | null {
    try {
      const compressed = readFileSync(gzPath);
      const content = gunzipSync(compressed).toString("utf-8");
      return this.parseAndFind(content, id);
    } catch {
      /* 解压或解析失败返回 null */
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
        /* 跳过损坏行 */
        continue;
      }
    }
    return null;
  }

  /**
   * 停止（保持接口兼容，新格式无 WriteStream 需要关闭）。
   */
  stop(): Promise<void> {
    return Promise.resolve();
  }
}

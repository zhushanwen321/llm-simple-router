import type Database from "better-sqlite3";
import type { RequestLogInsert, LogWriteContext } from "./logs.js";
import type { MetricsInsert } from "./metrics.js";

interface BufferedLogEntry {
  type: "log";
  data: RequestLogInsert;
  context?: LogWriteContext;
}

interface BufferedMetricsEntry {
  type: "metrics";
  data: MetricsInsert & { id: string };
}

type BufferedEntry = BufferedLogEntry | BufferedMetricsEntry;

export interface LogWriteBufferOptions {
  flushIntervalMs?: number;
  maxBufferSize?: number;
}

const DEFAULT_FLUSH_INTERVAL_MS = 100;
const DEFAULT_MAX_BUFFER_SIZE = 50;

/**
 * 批量缓冲 DB 日志写入，减少 SQLite 事务频率。
 *
 * 透明使用：logs.ts / metrics.ts 内部判断 buffer 是否存在，
 * 存在则 push 到缓冲，否则走原始同步路径。
 *
 * flush 策略：定时（100ms）+ 阈值（50 条）+ stop() 时同步 flush。
 */
export class LogWriteBuffer {
  private buffer: BufferedEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly flushIntervalMs: number;
  private readonly maxBufferSize: number;
  private stopped = false;

  constructor(
    private readonly db: Database.Database,
    private readonly rawInsertLog: (db: Database.Database, data: RequestLogInsert, ctx?: LogWriteContext) => void,
    private readonly rawInsertMetrics: (db: Database.Database, data: MetricsInsert & { id: string }) => void,
    options?: LogWriteBufferOptions,
  ) {
    this.flushIntervalMs = options?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxBufferSize = options?.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;

    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushIntervalMs);
    // 不阻止进程退出
    if (this.flushTimer && typeof this.flushTimer === "object" && "unref" in this.flushTimer) {
      this.flushTimer.unref();
    }
  }

  /** 推入日志条目到缓冲，达到阈值时立即 flush */
  pushLog(data: RequestLogInsert, context?: LogWriteContext): void {
    if (this.stopped) {
      this.rawInsertLog(this.db, data, context);
      return;
    }
    this.buffer.push({ type: "log", data, context });
    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  /**
   * 推入 metrics 条目到缓冲。
   * 调用方需预生成 UUID 并在 data.id 中传入。
   */
  pushMetrics(data: MetricsInsert & { id: string }): void {
    if (this.stopped) {
      this.rawInsertMetrics(this.db, data);
      return;
    }
    this.buffer.push({ type: "metrics", data });
    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  /** 同步批量写入所有缓冲条目（db.transaction 包裹） */
  flush(): void {
    if (this.buffer.length === 0) return;

    // 取出当前缓冲，重置数组，避免 flush 期间新 push 的条目丢失
    const entries = this.buffer;
    this.buffer = [];

    const transaction = this.db.transaction(() => {
      for (const entry of entries) {
        if (entry.type === "log") {
          this.rawInsertLog(this.db, entry.data, entry.context);
        } else {
          this.rawInsertMetrics(this.db, entry.data);
        }
      }
    });
    transaction();
  }

  /** 停止定时器 + 同步 flush 剩余数据。stop 后的 push 直接走同步写入。 */
  stop(): void {
    this.stopped = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  /** 当前缓冲区中的条目数（测试用） */
  get pendingCount(): number {
    return this.buffer.length;
  }
}

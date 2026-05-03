import { SemaphoreQueueFullError, SemaphoreTimeoutError } from "../errors.js";
export { SemaphoreQueueFullError, SemaphoreTimeoutError };
import type { ConcurrencyConfig } from "./types.js";
import type { Logger } from "../types.js";

interface QueueEntry {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout | null;
}

interface SemaphoreEntry {
  config: ConcurrencyConfig;
  current: number;
  queue: QueueEntry[];
  // 每次 updateConfig 重置 current 时递增，使旧请求的 release 失效
  generation: number;
}

// acquire() 返回的令牌，调用方需传给 release()
export interface AcquireToken {
  readonly generation: number;
  /** acquire 时 maxConcurrency=0（不计数），release 时跳过递减 */
  readonly bypassed: boolean;
}

export class SemaphoreManager {
  private readonly entries = new Map<string, SemaphoreEntry>();
  /** 全局 generation 计数器 — 每次 getOrCreate 分配唯一值，避免 disable+re-enable 后旧 token 匹配新条目 */
  private nextGeneration = 0;

  private getOrCreate(providerId: string): SemaphoreEntry {
    let entry = this.entries.get(providerId);
    if (!entry) {
      entry = {
        config: { maxConcurrency: 0, queueTimeoutMs: 0, maxQueueSize: 0 },
        current: 0,
        queue: [],
        generation: ++this.nextGeneration,
      };
      this.entries.set(providerId, entry);
    }
    return entry;
  }

  updateConfig(providerId: string, config: ConcurrencyConfig): void {
    const entry = this.getOrCreate(providerId);
    entry.config = config;

    if (config.maxConcurrency === 0) {
      while (entry.queue.length > 0) {
        const e = entry.queue.shift()!;
        if (e.timer) clearTimeout(e.timer);
        e.resolve();
      }
      // 递增 generation（全局唯一），使当前所有持有旧 token 的 release() 调用失效
      entry.generation = ++this.nextGeneration;
      entry.current = 0;
      return;
    }

    if (entry.current < 0) entry.current = 0;

    while (
      entry.current < config.maxConcurrency &&
      entry.queue.length > 0
    ) {
      entry.current++;
      const e = entry.queue.shift()!;
      if (e.timer) clearTimeout(e.timer);
      e.resolve();
    }
  }

  async acquire(
    providerId: string,
    signal?: AbortSignal,
    onQueued?: () => void,
    logger?: Logger,
    override?: { max_concurrency?: number; queue_timeout_ms?: number; max_queue_size?: number },
  ): Promise<AcquireToken> {
    const entry = this.getOrCreate(providerId);
    const maxConcurrency = override?.max_concurrency ?? entry.config.maxConcurrency;
    const queueTimeoutMs = Math.max(0, override?.queue_timeout_ms ?? entry.config.queueTimeoutMs);
    const maxQueueSize = Math.max(0, override?.max_queue_size ?? entry.config.maxQueueSize);

    if (maxConcurrency === 0) return { generation: entry.generation, bypassed: true };
    if (entry.current < maxConcurrency) {
      entry.current++;
      logger?.debug?.({ providerId, current: entry.current, maxConcurrency, action: "acquire_direct" }, "Semaphore: acquired directly");
      return { generation: entry.generation, bypassed: false };
    }

    if (entry.queue.length >= maxQueueSize) {
      logger?.debug?.({ providerId, queueLength: entry.queue.length, maxQueueSize, action: "acquire_rejected" }, "Semaphore: queue full, rejecting");
      throw new SemaphoreQueueFullError(providerId);
    }

    logger?.debug?.({ providerId, current: entry.current, maxConcurrency, queueLength: entry.queue.length, action: "acquire_queued" }, "Semaphore: entering wait queue");
    onQueued?.();
    return new Promise<AcquireToken>((resolve, reject) => {
      const token = { generation: entry.generation, bypassed: false };
      const qe: QueueEntry = {
        resolve: () => {
          logger?.debug?.({ providerId, current: entry.current, maxConcurrency, queueLength: entry.queue.length, action: "acquire_resolved" }, "Semaphore: left wait queue, acquired");
          resolve(token);
        },
        reject: (err: Error) => {
          logger?.debug?.({ providerId, action: "acquire_rejected_internal", error: err.message }, "Semaphore: wait queue entry rejected");
          reject(err);
        },
        timer: null,
      };

      if (queueTimeoutMs > 0) {
        qe.timer = setTimeout(() => {
          const idx = entry.queue.indexOf(qe);
          if (idx !== -1) entry.queue.splice(idx, 1);
          reject(new SemaphoreTimeoutError(providerId, queueTimeoutMs));
        }, queueTimeoutMs);
      }

      if (signal) {
        const onAbort = () => {
          const idx = entry.queue.indexOf(qe);
          if (idx !== -1) entry.queue.splice(idx, 1);
          if (qe.timer) clearTimeout(qe.timer);
          reject(new DOMException("Aborted", "AbortError"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }

      entry.queue.push(qe);
    });
  }

  release(providerId: string, token: AcquireToken, logger?: Logger): void {
    const entry = this.entries.get(providerId);
    if (!entry) return;
    // bypassed: acquire 时 maxConcurrency=0（不计数），release 跳过递减
    if (token.bypassed) return;
    // generation 不匹配说明此请求在 updateConfig 重置前 acquire，其槽位已被回收
    if (token.generation !== entry.generation) {
      logger?.debug?.({ providerId, tokenGen: token.generation, currentGen: entry.generation, action: "release_stale" }, "Semaphore: stale token, skipping release");
      return;
    }

    if (entry.queue.length > 0) {
      const e = entry.queue.shift()!;
      logger?.debug?.({ providerId, current: entry.current, maxConcurrency: entry.config.maxConcurrency, queueRemaining: entry.queue.length, action: "release_dequeue" }, "Semaphore: released, dequeued next waiter");
      if (e.timer) clearTimeout(e.timer);
      e.resolve();
    } else {
      entry.current--;
      logger?.debug?.({ providerId, current: entry.current, maxConcurrency: entry.config.maxConcurrency, action: "release_decrement" }, "Semaphore: released slot");
    }
  }

  getStatus(providerId: string): { active: number; queued: number } {
    const entry = this.entries.get(providerId);
    if (!entry) return { active: 0, queued: 0 };
    return { active: entry.current, queued: entry.queue.length };
  }

  remove(providerId: string): void {
    const entry = this.entries.get(providerId);
    if (!entry) return;

    for (const e of entry.queue) {
      if (e.timer) clearTimeout(e.timer);
      e.reject(new Error("Provider removed"));
    }
    this.entries.delete(providerId);
  }

  /** 清除所有 provider 的信号量配置（导入配置后调用） */
  removeAll(): void {
    for (const [, entry] of this.entries) {
      for (const e of entry.queue) {
        if (e.timer) clearTimeout(e.timer);
        e.reject(new Error("Provider removed"));
      }
    }
    this.entries.clear();
  }
}

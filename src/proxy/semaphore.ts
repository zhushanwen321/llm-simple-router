export class SemaphoreQueueFullError extends Error {
  constructor(public readonly providerId: string) {
    super(`Provider '${providerId}' concurrency queue is full`);
    this.name = "SemaphoreQueueFullError";
  }
}

export class SemaphoreTimeoutError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `Provider '${providerId}' concurrency wait timeout (${timeoutMs}ms)`,
    );
    this.name = "SemaphoreTimeoutError";
  }
}

interface ConcurrencyConfig {
  maxConcurrency: number;
  queueTimeoutMs: number;
  maxQueueSize: number;
}

interface QueueEntry {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout | null;
}

interface SemaphoreEntry {
  config: ConcurrencyConfig;
  current: number;
  queue: QueueEntry[];
}

export interface SemaphoreLogger {
  debug(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export class ProviderSemaphoreManager {
  private readonly entries = new Map<string, SemaphoreEntry>();

  private getOrCreate(providerId: string): SemaphoreEntry {
    let entry = this.entries.get(providerId);
    if (!entry) {
      entry = {
        config: { maxConcurrency: 0, queueTimeoutMs: 0, maxQueueSize: 0 },
        current: 0,
        queue: [],
      };
      this.entries.set(providerId, entry);
    }
    return entry;
  }

  updateConfig(providerId: string, config: ConcurrencyConfig): void {
    const entry = this.getOrCreate(providerId);
    entry.config = config;

    if (config.maxConcurrency === 0) {
      // Admin disabled throttling — drain queue without counting, reset current
      // because no tracking is needed when maxConcurrency=0
      while (entry.queue.length > 0) {
        const e = entry.queue.shift()!;
        if (e.timer) clearTimeout(e.timer);
        e.resolve();
      }
      entry.current = 0;
      return;
    }

    // 修正因先前的 bug 导致的负数 current（从 maxConcurrency=0 切回正值时）
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

  async acquire(providerId: string, signal?: AbortSignal, onQueued?: () => void, logger?: SemaphoreLogger): Promise<void> {
    const entry = this.getOrCreate(providerId);
    const { maxConcurrency, queueTimeoutMs, maxQueueSize } = entry.config;

    if (maxConcurrency === 0) return;
    if (entry.current < maxConcurrency) {
      entry.current++;
      logger?.debug({ providerId, current: entry.current, maxConcurrency, action: "acquire_direct" }, "Semaphore: acquired directly");
      return;
    }

    if (entry.queue.length >= maxQueueSize) {
      logger?.debug({ providerId, queueLength: entry.queue.length, maxQueueSize, action: "acquire_rejected" }, "Semaphore: queue full, rejecting");
      throw new SemaphoreQueueFullError(providerId);
    }

    logger?.debug({ providerId, current: entry.current, maxConcurrency, queueLength: entry.queue.length, action: "acquire_queued" }, "Semaphore: entering wait queue");
    onQueued?.();
    return new Promise<void>((resolve, reject) => {
      const qe: QueueEntry = {
        resolve: () => {
          logger?.debug({ providerId, current: entry.current, maxConcurrency, queueLength: entry.queue.length, action: "acquire_resolved" }, "Semaphore: left wait queue, acquired");
          resolve();
        },
        reject: (err: Error) => {
          logger?.debug({ providerId, action: "acquire_rejected_internal", error: err.message }, "Semaphore: wait queue entry rejected");
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

  release(providerId: string, logger?: SemaphoreLogger): void {
    const entry = this.entries.get(providerId);
    if (!entry) return;
    // maxConcurrency=0 时 acquire 不计数，release 也不应递减
    if (entry.config.maxConcurrency === 0) return;

    if (entry.queue.length > 0) {
      const e = entry.queue.shift()!;
      logger?.debug({ providerId, current: entry.current, maxConcurrency: entry.config.maxConcurrency, queueRemaining: entry.queue.length, action: "release_dequeue" }, "Semaphore: released, dequeued next waiter");
      if (e.timer) clearTimeout(e.timer);
      e.resolve();
    } else {
      entry.current--;
      logger?.debug({ providerId, current: entry.current, maxConcurrency: entry.config.maxConcurrency, action: "release_decrement" }, "Semaphore: released slot");
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
}

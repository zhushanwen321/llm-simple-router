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

  async acquire(providerId: string, signal?: AbortSignal): Promise<void> {
    const entry = this.getOrCreate(providerId);
    const { maxConcurrency, queueTimeoutMs, maxQueueSize } = entry.config;

    if (maxConcurrency === 0) return;
    if (entry.current < maxConcurrency) {
      entry.current++;
      return;
    }

    if (entry.queue.length >= maxQueueSize) {
      throw new SemaphoreQueueFullError(providerId);
    }

    return new Promise<void>((resolve, reject) => {
      const qe: QueueEntry = { resolve, reject, timer: null };

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

  release(providerId: string): void {
    const entry = this.entries.get(providerId);
    if (!entry) return;

    if (entry.queue.length > 0) {
      const e = entry.queue.shift()!;
      if (e.timer) clearTimeout(e.timer);
      e.resolve();
    } else {
      entry.current--;
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

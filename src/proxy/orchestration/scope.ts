import type { ProviderSemaphoreManager } from "./semaphore.js";
import type { ConcurrencyOverride } from "../../core/types.js";
import type { RequestTracker } from "../../monitor/request-tracker.js";
import type { ActiveRequest, AttemptSnapshot } from "../../monitor/types.js";

export class SemaphoreScope {
  constructor(private manager: ProviderSemaphoreManager) {}

  async withSlot<T>(
    providerId: string,
    signal: AbortSignal,
    onQueued: () => void,
    fn: () => Promise<T>,
    concurrencyOverride?: ConcurrencyOverride,
  ): Promise<T> {
    const token = await this.manager.acquire(providerId, signal, onQueued, undefined, concurrencyOverride);
    try {
      return await fn();
    } finally {
      this.manager.release(providerId, token);
    }
  }
}

export class TrackerScope {
  constructor(private tracker: RequestTracker) {}

  async track<T>(
    req: ActiveRequest,
    fn: () => Promise<T>,
    extractStatus: (result: T) => { status: "completed" | "failed"; statusCode?: number },
    extractAttempts?: (result: T) => AttemptSnapshot[],
  ): Promise<T> {
    this.tracker.start(req);
    try {
      const result = await fn();
      const status = extractStatus(result);
      const attempts = extractAttempts ? extractAttempts(result) : undefined;
      this.tracker.complete(req.id, { ...status, attempts });
      return result;
    } catch (e) {
      this.tracker.complete(req.id, { status: "failed" });
      throw e;
    }
  }

  /** 通知 tracker 请求进入/离开信号量队列，触发前端即时广播 */
  markQueued(id: string, queued: boolean): void {
    this.tracker.update(id, { queued });
  }
}

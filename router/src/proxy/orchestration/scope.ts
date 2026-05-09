import type { SemaphoreManager } from "@llm-router/core/concurrency";
import type { ConcurrencyOverride } from "../../core/types.js";
import type { RequestTracker } from "@llm-router/core/monitor";
import type { ActiveRequest, AttemptSnapshot } from "@llm-router/core/monitor";

export class SemaphoreScope {
  constructor(private manager: SemaphoreManager) {}

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

  /** 注册请求终止回调，代理到 RequestTracker */
  registerKillCallback(id: string, callback: () => void): void {
    this.tracker.registerKillCallback(id, callback);
  }
}

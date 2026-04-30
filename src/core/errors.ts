// src/core/errors.ts
// 被多目录共享的错误类型（从 proxy/semaphore.ts 和 proxy/types.ts 移出）

import type { TransportResult, ResilienceAttempt } from "./types.js";

/**
 * Provider 并发队列已满时抛出。
 */
export class SemaphoreQueueFullError extends Error {
  constructor(public readonly providerId: string) {
    super(`Provider '${providerId}' concurrency queue is full`);
    this.name = "SemaphoreQueueFullError";
  }
}

/**
 * Provider 并发等待超时时抛出。
 */
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

/**
 * 跨 provider failover 时由 ResilienceLayer 抛出，
 * orchestrator 捕获后释放当前信号量并获取新 provider 的信号量。
 */
export class ProviderSwitchNeeded extends Error {
  constructor(
    public readonly targetProviderId: string,
    public readonly attempts?: ResilienceAttempt[],
    public readonly lastResult?: TransportResult,
  ) {
    super(`Provider switch needed: ${targetProviderId}`);
    this.name = "ProviderSwitchNeeded";
  }
}

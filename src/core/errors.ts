// src/core/errors.ts
// 被多目录共享的错误类型

import type { TransportResult } from "./types.js";

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

export class ProviderSwitchNeeded extends Error {
  constructor(
    public readonly targetProviderId: string,
    public readonly attempts?: import("../proxy/resilience.js").ResilienceAttempt[],
    public readonly lastResult?: TransportResult,
  ) {
    super(`Provider switch needed: ${targetProviderId}`);
    this.name = "ProviderSwitchNeeded";
  }
}

// src/core/errors.ts
// Re-export core errors + router-specific errors

// Re-export errors that have been migrated to llm-router-core
export { SemaphoreQueueFullError, SemaphoreTimeoutError } from "llm-router-core";

import type { TransportResult, ResilienceAttempt } from "./types.js";

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

/** Provider-level concurrency control configuration. */
export interface ConcurrencyConfig {
  maxConcurrency: number;
  queueTimeoutMs: number;
  maxQueueSize: number;
}

/** Internal state of adaptive concurrency for a provider. */
export interface AdaptiveState {
  currentLimit: number;
  probeActive: boolean;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  cooldownUntil: number;
}

/** Result of a request for adaptive concurrency feedback. */
export interface AdaptiveResult {
  success: boolean;
  statusCode?: number;
  /** 重试规则是否匹配（resilience 层判断为可重试的失败），为 true 时忽略 statusCode 过滤 */
  retryRuleMatched?: boolean;
  /** 触发此反馈的请求日志 ID，用于日志关联 */
  requestId?: string;
}

/** Abstraction for semaphore operations (decouples AdaptiveController). */
export interface ISemaphoreControl {
  updateConfig(providerId: string, config: ConcurrencyConfig): void;
}

/** Provider DB fields for adaptive/manual concurrency. */
export interface ProviderConcurrencyParams {
  adaptive_enabled: number;
  max_concurrency: number;
  queue_timeout_ms: number;
  max_queue_size: number;
}

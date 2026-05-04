// llm-router-core — unified re-export
// Individual sub-path imports also available:
//   llm-router-core/concurrency
//   llm-router-core/loop-prevention
//   llm-router-core/monitor

export { SemaphoreQueueFullError, SemaphoreTimeoutError } from "./errors.js";
export type { Logger } from "./types.js";

// Concurrency
export { SemaphoreManager, AdaptiveController } from "./concurrency/index.js";
export type { AcquireToken, ConcurrencyConfig, AdaptiveState, AdaptiveResult, ISemaphoreControl, ProviderConcurrencyParams } from "./concurrency/index.js";

// Loop prevention
export {
  SessionTracker,
  StreamLoopGuard,
  ToolLoopGuard,
  NGramLoopDetector,
  DEFAULT_LOOP_PREVENTION_CONFIG,
} from "./loop-prevention/index.js";
export type {
  LoopPreventionConfig,
  StreamLoopGuardConfig,
  ToolLoopGuardConfig,
  SessionTrackerConfig,
  NGramDetectorConfig,
  ToolCallRecord,
  LoopCheckResult,
  LoopDetector,
  LoopDetectorStatus,
} from "./loop-prevention/index.js";

// Monitor
export { RequestTracker, StatsAggregator, RuntimeCollector } from "./monitor/index.js";
export type { ISemaphoreStatus, IAdaptiveStatus } from "./monitor/index.js";
export type {
  ActiveRequest, AttemptSnapshot, ContentBlock,
  ProviderConcurrencySnapshot, ProviderStats, RuntimeMetrics,
  SSEClient, StatsSnapshot, StreamContentSnapshot, StreamMetricsSnapshot,
} from "./monitor/index.js";

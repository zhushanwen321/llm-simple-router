// src/core/registry.ts
// Admin 层通过此接口触发 proxy 层状态刷新，消除 admin→proxy 直接依赖

export interface ConcurrencyConfig {
  maxConcurrency: number;
  queueTimeoutMs: number;
  maxQueueSize: number;
}

export interface EnhancementConfig {
  claude_code_enabled: boolean;
  tool_call_loop_enabled: boolean;
  stream_loop_enabled: boolean;
}

export interface StateRegistry {
  refreshRetryRules(): void;
  updateProviderConcurrency(providerId: string, config: ConcurrencyConfig): void;
  clearModelState(): void;
  getEnhancementConfig(): EnhancementConfig;
}

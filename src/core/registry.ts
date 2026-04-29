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
  /** 刷新重试规则缓存（RetryRuleMatcher.load） */
  refreshRetryRules(): void;
  /** 更新 provider 并发配置（ProviderSemaphoreManager.updateConfig） */
  updateProviderConcurrency(providerId: string, config: ConcurrencyConfig): void;
  /** 移除 provider 的信号量（ProviderSemaphoreManager.remove） */
  removeProvider(providerId: string): void;
  /** 移除所有信号量配置（ProviderSemaphoreManager.removeAll） */
  removeAllProviders(): void;
  /** 获取 provider 并发状态（ProviderSemaphoreManager.getStatus） */
  getProviderStatus(providerId: string): { active: number; queued: number };
  /** 清空所有会话模型状态（modelState.clearAll） */
  clearModelState(): void;
  /** 删除指定会话模型状态（modelState.delete） */
  deleteModelState(keyId: string, sessionId: string): void;
  /** 读取 proxy enhancement 配置 */
  getEnhancementConfig(): EnhancementConfig;
}

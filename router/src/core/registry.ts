// src/core/registry.ts
// Admin 层通过此接口触发 proxy 层状态刷新，消除 admin→proxy 直接依赖

import type { ConcurrencyConfig } from "./types.js";

export type { ConcurrencyConfig };

export interface EnhancementConfig {
  claude_code_enabled: boolean;
  tool_call_loop_enabled: boolean;
  stream_loop_enabled: boolean;
}

/** Provider 自适应/手动并发配置（DB 字段） */
export interface ProviderConcurrencyParams {
  adaptive_enabled: number;
  max_concurrency: number;
  queue_timeout_ms: number;
  max_queue_size: number;
}

export interface StateRegistry {
  /** 刷新重试规则缓存（RetryRuleMatcher.load） */
  refreshRetryRules(): void;
  /** 更新 provider 并发配置（SemaphoreManager.updateConfig） */
  updateProviderConcurrency(providerId: string, config: ConcurrencyConfig): void;
  /** 移除 provider 的信号量（SemaphoreManager.remove） */
  removeProvider(providerId: string): void;
  /** 移除所有信号量配置（SemaphoreManager.removeAll） */
  removeAllProviders(): void;
  /** 获取 provider 并发状态（SemaphoreManager.getStatus） */
  getProviderStatus(providerId: string): { active: number; queued: number };
  /** 清空所有会话模型状态（modelState.clearAll） */
  clearModelState(): void;
  /** 删除指定会话模型状态（modelState.delete） */
  deleteModelState(keyId: string, sessionId: string): void;
  /** 读取 proxy enhancement 配置 */
  getEnhancementConfig(): EnhancementConfig;
  /** 同步 provider 的自适应并发配置（AdaptiveController.syncProvider） */
  syncAdaptiveProvider(providerId: string, params: ProviderConcurrencyParams): void;
  /** 移除 provider 的自适应并发状态（AdaptiveController.remove） */
  removeAdaptiveProvider(providerId: string): void;
  /** 获取 provider 的自适应并发状态 */
  getAdaptiveStatus(providerId: string): import("llm-router-core/concurrency").AdaptiveState | undefined;
  /** 从 DB 重新读取所有 provider 配置，重建信号量/adaptive/tracker 缓存（导入配置后调用） */
  reinitializeProviders(): void;
}

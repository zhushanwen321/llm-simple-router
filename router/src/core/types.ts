// src/core/types.ts
// 被多个目录（proxy, db, monitor, admin）共享的类型定义

// Re-export ConcurrencyConfig from merged core
export type { ConcurrencyConfig } from "./concurrency/types.js";

/** Generic logger interface for core package decoupling from pino/fastify. */
export interface Logger {
  debug?(obj: Record<string, unknown>, msg: string): void;
  info?(obj: Record<string, unknown>, msg: string): void;
  warn?(obj: Record<string, unknown>, msg: string): void;
  error?(obj: Record<string, unknown>, msg: string): void;
}

// ========== 来自原 proxy/strategy/types.ts ==========

/** Target 级熔断配置（模型映射故障转移链熔断） */
export interface CircuitBreakerConfig {
  enabled: boolean;
  /** 滑动时间窗口（秒），默认 60 */
  window_sec: number;
  /** 失败率阈值 0~1，默认 0.9 */
  failure_rate: number;
  /** 窗口内最小样本数（防 1 次失败=100% 误熔断），默认 10 */
  min_samples: number;
  /** 熔断持续时长（秒），默认 300 */
  cooldown_sec: number;
  /** 可选：仅过滤有 statusCode 的失败（每项 400~599）；缺省=所有失败计入。throw（连接级错误）不受此限 */
  status_codes?: number[];
}

export interface Target {
  backend_model: string;
  provider_id: string;
  overflow_provider_id?: string;
  overflow_model?: string;
  /** 熔断配置（可选，无配置=无熔断行为，向后兼容） */
  circuit_breaker?: CircuitBreakerConfig;
}

export interface ResolveContext {
  now: Date;
  excludeTargets?: Target[];
}

export interface ConcurrencyOverride {
  max_concurrency?: number;
  queue_timeout_ms?: number;
  max_queue_size?: number;
}

export type MappingReason =
  | "direct_format"
  | "group_base_rule"
  | "group_schedule"
  | "fallback_provider"
  | "overflow_redirect"
  | "failover_retry"
  | "circuit_breaker_skip"
  | "session_affinity";

export interface ResolveResult {
  target: Target;
  concurrency_override?: ConcurrencyOverride;
  /** 活跃规则（schedule 或 base）中的 target 总数，用于 failover 判断 */
  targetCount: number;
  /** 排除前的完整 target 列表，用于请求级缓存（BP-H2） */
  allTargets?: Target[];
  /** 映射解析原因，标识走了哪条解析路径 */
  mappingReason: MappingReason;
  // 以下三字段为熔断/亲和特性预留，设为可选以允许本类型独立演进——
  // 由 W4 resolveMapping 填充（填充后运行时恒有值）：
  /** group 维度：熔断状态 key 构造用（direct/fallback 路径为 null 不构造 key）。可选 */
  group_id?: string | null;
  /** schedule 维度：仅 mappingReason==='group_schedule' 才有值，否则 undefined。可选 */
  schedule_id?: string | undefined;
  /** 该 group 配置级目标集合的 `${provider_id}:${backend_model}`，供 session 绑定失效判定。可选 */
  configLevelTargetKeys?: Set<string>;
}

// ========== 来自原 proxy/types.ts 公共部分 ==========

// ========== 来自原 metrics/metrics-extractor.ts ==========

export interface MetricsResult {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
  cache_read_tokens_estimated?: number;
  ttft_ms: number | null;
  /** T6 - T0: proxy end-to-end streaming duration */
  total_duration_ms: number | null;
  /** @deprecated Use total_tps instead */
  tokens_per_second: number | null;
  stop_reason: string | null;
  is_complete: number;
  input_tokens_estimated?: number;
  // --- Two-phase TPS: thinking / non-thinking ---
  thinking_tokens: number | null;
  /** T3 - T0: request start to last thinking delta */
  thinking_duration_ms: number | null;
  thinking_tps: number | null;
  /** T6 - T3 (thinking) or T6 - T0 (non-thinking) */
  non_thinking_duration_ms: number | null;
  non_thinking_tps: number | null;
  total_tps: number | null;
  // --- Content counts (for analysis, not TPS) ---
  text_tokens: number | null;
  tool_use_tokens: number | null;
}

// ========== 来自原 proxy/types.ts 公共部分 ==========

/** Provider endpoint API 类型（openai / openai-responses / anthropic） */
export type ApiType = "openai" | "openai-responses" | "anthropic";

export type RawHeaders = Record<string, string | string[] | undefined>;

export type TransportResult =
  | {
      kind: "success";
      statusCode: number;
      body: string;
      headers: Record<string, string>;
      sentHeaders: Record<string, string>;
      sentBody: string;
    }
  | {
      kind: "stream_success";
      statusCode: number;
      metrics?: MetricsResult;
      upstreamResponseHeaders?: Record<string, string>;
      sentHeaders: Record<string, string>;
    }
  | {
      kind: "stream_error";
      statusCode: number;
      body: string;
      headers: Record<string, string>;
      sentHeaders: Record<string, string>;
      headersSent?: boolean;
    }
  | {
      kind: "stream_abort";
      statusCode: number;
      metrics?: MetricsResult;
      upstreamResponseHeaders?: Record<string, string>;
      sentHeaders: Record<string, string>;
      timeoutContext?: { modelId: string; providerId: string };
      timeoutMs?: number;
      abortReason?: "idle_timeout" | "client_disconnect" | "loop_detection" | "pipe_error";
    }
  | {
      kind: "error";
      statusCode: number;
      body: string;
      headers: Record<string, string>;
      sentHeaders: Record<string, string>;
      sentBody: string;
    }
  | {
      kind: "throw";
      error: Error;
      headersSent?: boolean;
    };

/** 单次 resilience 尝试的记录 */
export interface ResilienceAttempt {
  target: Target;
  attemptIndex: number;
  statusCode: number | null;
  error: string | null;
  latencyMs: number;
  responseBody: string | null;
  /** 上游响应 headers（throw 和 stream_success/stream_abort 时为 null） */
  responseHeaders: Record<string, string> | null;
  /** TransportResult.kind，用于区分 stream_error 等特殊类型 */
  resultKind: TransportResult["kind"];
  /** error.code（如 ETIMEDOUT / ECONNRESET / ECONNREFUSED），仅 throw 时有值 */
  error_code?: string | null;
  /** response headers 是否已发送，影响重试/failover 决策 */
  headers_sent?: boolean | null;
}

/** Provider endpoint — stored in providers.endpoints JSON field */
export interface ProviderEndpoint {
  api_type: ApiType;
  base_url: string;
  upstream_path?: string | null;
  api_key?: string | null; // null = fallback 到 provider.api_key
}

/** resolveEndpoint() 的输出 — 所有下游消费者只消费此对象 */
export interface ResolvedEndpoint {
  api_type: ApiType;
  base_url: string;
  upstream_path: string | null;
  api_key: string; // 已解密的最终 key（永远不会是 null）
  needs_transform: boolean; // 是否需要 FormatRegistry 格式转换
}

/** 流式传输阶段状态 */
export type StreamState =
  | "BUFFERING"
  | "STREAMING"
  | "COMPLETED"
  | "EARLY_ERROR"
  | "ABORTED";

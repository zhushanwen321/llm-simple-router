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

export interface Target {
  backend_model: string;
  provider_id: string;
  overflow_provider_id?: string;
  overflow_model?: string;
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

export interface ResolveResult {
  target: Target;
  concurrency_override?: ConcurrencyOverride;
  /** 活跃规则（schedule 或 base）中的 target 总数，用于 failover 判断 */
  targetCount: number;
}

// ========== 来自原 proxy/types.ts 公共部分 ==========

// ========== 来自原 metrics/metrics-extractor.ts ==========

export interface MetricsResult {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
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
}

/** 流式传输阶段状态 */
export type StreamState =
  | "BUFFERING"
  | "STREAMING"
  | "COMPLETED"
  | "EARLY_ERROR"
  | "ABORTED";

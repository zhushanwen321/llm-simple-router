import type { MetricsResult } from "../metrics/metrics-extractor.js";

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

export const UPSTREAM_SUCCESS = 200;

export type RawHeaders = Record<string, string | string[] | undefined>;

/** 过滤掉不应转发给下游的 hop-by-hop headers */
const SKIP_DOWNSTREAM = new Set([
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

export function filterHeaders(raw: RawHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value == null || SKIP_DOWNSTREAM.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

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

/** 流式传输阶段状态 */
export type StreamState =
  | "BUFFERING"
  | "STREAMING"
  | "COMPLETED"
  | "EARLY_ERROR"
  | "ABORTED";

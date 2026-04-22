import type { MetricsResult } from "../metrics/metrics-extractor.js";

// ---------- Shared constants & types ----------

export const UPSTREAM_SUCCESS = 200;

export type RawHeaders = Record<string, string | string[] | undefined>;

/**
 * 上游调用的传输层结果。
 * discriminated union，按 kind 区分 6 种情况：
 * - success / stream_success：正常完成
 * - stream_error / stream_abort：流式传输中途异常
 * - error：非流式错误响应
 * - throw：未捕获异常
 */
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
    };

/**
 * 跨 provider failover 时由 ResilienceLayer 抛出，
 * orchestrator 捕获后释放当前信号量并获取新 provider 的信号量。
 */
export class ProviderSwitchNeeded extends Error {
  constructor(public readonly targetProviderId: string) {
    super(`Provider switch needed: ${targetProviderId}`);
    this.name = "ProviderSwitchNeeded";
  }
}

/** 流式传输阶段状态 */
export type StreamState =
  | "BUFFERING"
  | "STREAMING"
  | "COMPLETED"
  | "EARLY_ERROR"
  | "ABORTED";

import type { FastifyReply, FastifyRequest } from "fastify";
import { getProviderById } from "../../db/index.js";
import { callNonStream, callStream } from "./http.js";
import { SSEMetricsTransform } from "../../metrics/sse-metrics-transform.js";
import { MetricsExtractor } from "../../metrics/metrics-extractor.js";
import type { MetricsResult } from "../types.js";
import { buildUpstreamHeaders } from "../proxy-core.js";
import { StreamLoopGuard } from "@llm-router/core/loop-prevention";
import { NGramLoopDetector } from "@llm-router/core/loop-prevention";
import { UPSTREAM_SUCCESS } from "../types.js";
import type { RawHeaders, TransportResult } from "../types.js";
import type { Target } from "../../core/types.js";
import type { RequestTracker } from "@llm-router/core/monitor";
import type { RetryRuleMatcher } from "../orchestration/retry-rules.js";
import { DEFAULT_MAX_RAW as STREAM_CONTENT_MAX_RAW, DEFAULT_MAX_TEXT as STREAM_CONTENT_MAX_TEXT } from "@llm-router/core/monitor";

const LOOP_DETECTOR_N = 6;
const LOOP_DETECTOR_WINDOW_SIZE = 1000;
const LOOP_DETECTOR_REPEAT_THRESHOLD = 10;

function toStreamMetrics(m: MetricsResult) {
  return {
    inputTokens: m.input_tokens,
    outputTokens: m.output_tokens,
    cacheReadTokens: m.cache_read_tokens,
    ttftMs: m.ttft_ms,
    tokensPerSecond: m.tokens_per_second,
    stopReason: m.stop_reason,
    isComplete: m.is_complete === 1,
    // Two-phase TPS breakdown
    thinkingTokens: m.thinking_tokens,
    thinkingDurationMs: m.thinking_duration_ms,
    thinkingTps: m.thinking_tps,
    nonThinkingDurationMs: m.non_thinking_duration_ms,
    nonThinkingTps: m.non_thinking_tps,
    totalTps: m.total_tps,
    // Content counts (for analysis)
    textTokens: m.text_tokens,
    toolUseTokens: m.tool_use_tokens,
  };
}

export interface TransportFnParams {
  provider: NonNullable<ReturnType<typeof getProviderById>>;
  apiKey: string;
  body: Record<string, unknown>;
  cliHdrs: RawHeaders;
  reply: FastifyReply;
  upstreamPath: string;
  apiType: "openai" | "openai-responses" | "anthropic";
  isStream: boolean;
  startTime: number;
  logId: string;
  effectiveModel: string;
  streamTimeoutMs: number;
  tracker?: RequestTracker;
  matcher?: RetryRuleMatcher;
  request: FastifyRequest;
  streamLoopEnabled: boolean;
  formatTransform?: import("stream").Transform;
  responseTransform?: (body: string) => string;
  injectedHeaders?: Record<string, string>;
}

export function buildTransportFn(p: TransportFnParams): (target: Target) => Promise<TransportResult> {
  const buildHeaders = (cliHdrs: RawHeaders, key: string, bytes?: number) => {
    const base = buildUpstreamHeaders(cliHdrs, key, bytes, p.apiType);
    return p.injectedHeaders ? { ...base, ...p.injectedHeaders } : base;
  };
  // _target 未使用 — resilience 层始终传入当前 resolved target；
  // 跨 target failover 由外层 executeFailoverLoop 的 ProviderSwitchNeeded 处理
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return async (_target: Target) => {
    if (p.isStream) {
      let streamLoopGuard: StreamLoopGuard | undefined;
      if (p.streamLoopEnabled) {
        streamLoopGuard = new StreamLoopGuard(
          { enabled: true, detectorConfig: { n: LOOP_DETECTOR_N, windowSize: LOOP_DETECTOR_WINDOW_SIZE, repeatThreshold: LOOP_DETECTOR_REPEAT_THRESHOLD } },
          new NGramLoopDetector({ n: LOOP_DETECTOR_N, windowSize: LOOP_DETECTOR_WINDOW_SIZE, repeatThreshold: LOOP_DETECTOR_REPEAT_THRESHOLD }),
          (reason) => {
            p.request.log.warn({ logId: p.logId, reason }, "Stream loop detected, aborting");
          },
        );
      }
      const metricsTransform = new SSEMetricsTransform(p.apiType, p.startTime, {
        onMetrics: (m) => { p.tracker?.update(p.logId, { streamMetrics: toStreamMetrics(m) }); },
        onChunk: (rawLine) => { p.tracker?.appendStreamChunk(p.logId, rawLine, p.apiType, STREAM_CONTENT_MAX_RAW, STREAM_CONTENT_MAX_TEXT); },
        onContentDelta: streamLoopGuard ? (text) => streamLoopGuard.feed(text) : undefined,
      });
      const checkEarlyError = p.matcher ? (data: string) => p.matcher!.test(UPSTREAM_SUCCESS, data) : undefined;
      const streamResult = await callStream(
        p.provider, p.apiKey, p.body, p.cliHdrs, p.reply, p.streamTimeoutMs,
        p.upstreamPath, buildHeaders, metricsTransform, checkEarlyError, undefined, streamLoopGuard, p.formatTransform,
      );
      const m = (streamResult.kind === "stream_success" || streamResult.kind === "stream_abort")
        ? streamResult.metrics : undefined;
      if (m) p.tracker?.update(p.logId, { streamMetrics: toStreamMetrics(m) });
      return streamResult;
    }
    let result = await callNonStream(p.provider, p.apiKey, p.body, p.cliHdrs, p.upstreamPath, buildHeaders);
    if (result.kind === "success") {
      const mr = MetricsExtractor.fromNonStreamResponse(p.apiType, result.body);
      if (mr) p.tracker?.update(p.logId, { streamMetrics: toStreamMetrics(mr) });
    }
    // Apply format transformation (responseTransform handles both success and error internally)
    if (p.responseTransform && "body" in result && result.body) {
      result = { ...result, body: p.responseTransform(result.body) };
    }
    return result;
  };
}

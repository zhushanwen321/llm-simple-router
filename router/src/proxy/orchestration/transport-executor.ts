/**
 * TransportExecutor — 统一传输执行器。
 *
 * 将 transport/http.ts 的 callNonStream() 和 transport/stream.ts 的 callStream()
 * 封装为统一的 execute() 方法，集成 resilience 层重试逻辑。
 *
 * TransportContext 包含执行传输所需的全部参数。
 * TransportResult 为执行结果（不含 resilience 元数据，由调用方决策下一步）。
 */
import type { FastifyReply } from "fastify";
import type { Agent } from "http";
import { callNonStream, callStream } from "../transport/http.js";
import { buildUpstreamHeaders } from "../proxy-core.js";
import { UPSTREAM_SUCCESS } from "../types.js";
import { SSEMetricsTransform } from "../../metrics/sse-metrics-transform.js";
import { MetricsExtractor } from "../../metrics/metrics-extractor.js";
import type { RawHeaders, TransportResult } from "../types.js";
import type { Target } from "../../core/types.js";
import type { ResilienceLayer, ResilienceConfig, ResilienceResult } from "./resilience.js";
import { ResilienceLayer as ResilienceLayerClass } from "./resilience.js";

const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_FAILOVER_THRESHOLD = 400;
const DEFAULT_STREAM_CHUNK_LIMIT = 4096;
const DEFAULT_STREAM_CHUNK_COUNT = 500;
import type { RequestTracker } from "../../core/monitor/index.js";
import type { RetryRuleMatcher } from "./retry-rules.js";
import type { ProxyAgentFactory, ProxyConfig } from "../transport/proxy-agent.js";
import type { Provider } from "../../db/providers.js";

// ---------- TransportContext ----------

export interface TransportContext {
  provider: Pick<Provider, "base_url" | "id" | "name" | "api_type"> & { proxy_type?: string | null; proxy_url?: string | null; proxy_username?: string | null; proxy_password?: string | null };
  apiKey: string;
  body: Record<string, unknown>;
  cliHdrs: RawHeaders;
  reply: FastifyReply;
  upstreamPath: string;
  apiType: "openai" | "openai-responses" | "anthropic";
  isStream: boolean;
  startTime: number;
  logId: string;
  streamTimeoutMs: number;
  tracker?: RequestTracker;
  matcher?: RetryRuleMatcher;
  responseTransform?: (body: string) => string;
  injectedHeaders?: Record<string, string>;
  timeoutContext?: { modelId: string; providerId: string };
  proxyAgentFactory?: ProxyAgentFactory;
}

// ---------- TransportExecutor ----------

export class TransportExecutor {
  private resilience: ResilienceLayer;

  constructor(resilience?: ResilienceLayer) {
    this.resilience = resilience ?? new ResilienceLayerClass();
  }

  /**
   * 执行单次传输调用（不含重试）。
   * 根据 isStream 选择 callNonStream 或 callStream。
   */
  async executeOnce(target: Target, ctx: TransportContext): Promise<TransportResult> {
    const buildHeaders = (cliHdrs: RawHeaders, key: string, bytes?: number) => {
      const base = buildUpstreamHeaders(cliHdrs, key, bytes, ctx.apiType);
      return ctx.injectedHeaders ? { ...base, ...ctx.injectedHeaders } : base;
    };

    const agent = ctx.proxyAgentFactory
      ? (ctx.proxyAgentFactory.getAgent(ctx.provider as unknown as ProxyConfig) ??
         ctx.proxyAgentFactory.getKeepAliveAgent(ctx.provider.base_url))
      : undefined;

    if (ctx.isStream) {
      return this.executeStream(ctx, buildHeaders, agent);
    }
    return this.executeNonStream(ctx, buildHeaders, agent);
  }

  /**
   * 执行带 resilience 重试的传输调用。
   * 对同一个 target 的重试由 resilience 层处理。
   * 返回 ResilienceResult 包含完整的尝试记录和决策结果。
   */
  async executeWithResilience(
    targets: Target[],
    ctx: TransportContext,
    config?: Partial<ResilienceConfig>,
  ): Promise<ResilienceResult> {
    const transportFn = (target: Target) => this.executeOnce(target, ctx);

    const resilienceConfig: ResilienceConfig = {
      baseDelayMs: config?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
      failoverThreshold: config?.failoverThreshold ?? DEFAULT_FAILOVER_THRESHOLD,
      isFailover: config?.isFailover ?? targets.length > 1,
      ruleMatcher: config?.ruleMatcher ?? ctx.matcher,
      iterationCap: config?.iterationCap,
    };

    return this.resilience.execute(
      () => targets,
      transportFn,
      resilienceConfig,
    );
  }

  // ---------- Private: stream transport ----------

  private async executeStream(
    ctx: TransportContext,
    buildHeaders: (cliHdrs: RawHeaders, key: string, bytes?: number) => Record<string, string>,
    agent?: Agent,
  ): Promise<TransportResult> {
    const metricsTransform = ctx.tracker
      ? new SSEMetricsTransform(ctx.apiType, ctx.startTime, {
        onMetrics: (m) => {
            ctx.tracker!.update(ctx.logId, { streamMetrics: toStreamMetricsObj(m) });
        },
        onChunk: (rawLine) => {
            ctx.tracker!.appendStreamChunk(
              ctx.logId, rawLine, ctx.apiType, DEFAULT_STREAM_CHUNK_LIMIT, DEFAULT_STREAM_CHUNK_COUNT,
            );
        },
      })
      : undefined;

    if (metricsTransform) {
      metricsTransform.on("error", (_err) => {
        // 指标采集错误不影响业务数据流，仅记录
      });
    }

    const checkEarlyError = ctx.matcher
      ? (data: string) => ctx.matcher!.test(UPSTREAM_SUCCESS, data)
      : undefined;

    const result = await callStream(
      ctx.provider,
      ctx.apiKey,
      ctx.body,
      ctx.cliHdrs,
      ctx.reply,
      ctx.streamTimeoutMs,
      ctx.upstreamPath,
      buildHeaders,
      metricsTransform,
      checkEarlyError,
      undefined,
      undefined,
      undefined,
      ctx.timeoutContext,
      undefined,
      agent,
    );

    // 更新 tracker stream metrics
    if ((result.kind === "stream_success" || result.kind === "stream_abort") && result.metrics && ctx.tracker) {
      ctx.tracker.update(ctx.logId, { streamMetrics: toStreamMetricsObj(result.metrics) });
    }

    return result;
  }

  // ---------- Private: non-stream transport ----------

  private async executeNonStream(
    ctx: TransportContext,
    buildHeaders: (cliHdrs: RawHeaders, key: string, bytes?: number) => Record<string, string>,
    agent?: Agent,
  ): Promise<TransportResult> {
    let result = await callNonStream(
      ctx.provider,
      ctx.apiKey,
      ctx.body,
      ctx.cliHdrs,
      ctx.upstreamPath,
      buildHeaders,
      agent,
    );

    // 更新 tracker metrics
    if (result.kind === "success") {
      const mr = MetricsExtractor.fromNonStreamResponse(ctx.apiType, result.body);
      if (mr && ctx.tracker) {
        ctx.tracker.update(ctx.logId, { streamMetrics: toStreamMetricsObj(mr) });
      }
    }

    // 应用 response transform
    if (ctx.responseTransform && "body" in result && result.body) {
      result = { ...result, body: ctx.responseTransform(result.body) };
    }

    return result;
  }
}

// ---------- Helpers ----------

import type { MetricsResult } from "../types.js";

function toStreamMetricsObj(m: MetricsResult) {
  return {
    inputTokens: m.input_tokens,
    outputTokens: m.output_tokens,
    cacheReadTokens: m.cache_read_tokens,
    cacheReadTokensEstimated: m.cache_read_tokens_estimated,
    ttftMs: m.ttft_ms,
    tokensPerSecond: m.tokens_per_second,
    stopReason: m.stop_reason,
    isComplete: m.is_complete === 1,
    thinkingTokens: m.thinking_tokens,
    thinkingDurationMs: m.thinking_duration_ms,
    thinkingTps: m.thinking_tps,
    nonThinkingDurationMs: m.non_thinking_duration_ms,
    nonThinkingTps: m.non_thinking_tps,
    totalTps: m.total_tps,
    textTokens: m.text_tokens,
    toolUseTokens: m.tool_use_tokens,
  };
}

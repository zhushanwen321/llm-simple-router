import type { FastifyReply, FastifyRequest } from "fastify";
import type { TransportResult } from "../types.js";
import { ProviderSwitchNeeded } from "../types.js";
import type { Target, ConcurrencyOverride } from "../../core/types.js";
import type { ResilienceLayer, ResilienceResult, ResilienceConfig } from "./resilience.js";
import { ResilienceLayer as ResilienceLayerClass } from "./resilience.js";
import type { RetryRuleMatcher } from "./retry-rules.js";
import type { SemaphoreScope } from "./scope.js";
import { SemaphoreScope as SemaphoreScopeClass } from "./scope.js";
import type { TrackerScope } from "./scope.js";
import { TrackerScope as TrackerScopeClass } from "./scope.js";
import type { ActiveRequest } from "../../core/monitor/types.js";
import type { SemaphoreManager } from "../../core/concurrency/index.js";
import { SemaphoreTimeoutError, SemaphoreQueueFullError } from "../../core/errors.js";
import type { RequestTracker } from "../../core/monitor/index.js";
import type { AdaptiveController } from "../../core/concurrency/index.js";

const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_FAILOVER_THRESHOLD = 400;

export interface OrchestratorConfig {
  resolved: Target;
  provider: {
    id: string; name: string; is_active: number; api_type: string;
    base_url: string; api_key: string;
  };
  clientModel: string;
  isStream: boolean;
  /** 外部生成的 tracker ID，用于 tracker.appendStreamChunk / tracker.update 等回调匹配 */
  trackerId?: string;
  /** Session ID，由 client-detection hook 通过 metadata 设置 */
  sessionId?: string;
  /** 客户端请求的 JSON 字符串（headers + body），用于 Monitor 实时查看 */
  clientRequest?: string;
  /** 上游请求的 JSON 字符串（url + headers + body），用于 Monitor 实时查看 */
  upstreamRequest?: string;
  /** Schedule 层的并发覆盖配置，覆盖 Provider 默认并发限制 */
  concurrencyOverride?: ConcurrencyOverride;
}

export interface HandleContext {
  streamTimeoutMs?: number;
  retryBaseDelayMs?: number;
  failoverThreshold?: number;
  isFailover?: boolean;
  ruleMatcher?: RetryRuleMatcher;
  transportFn: (target: Target) => Promise<TransportResult>;
}

/**
 * 工厂函数，消除 openai/anthropic 创建 orchestrator 的重复代码。
 * 两个 provider 的创建逻辑完全一致。
 */
export function createOrchestrator(
  semaphoreManager?: SemaphoreManager,
  tracker?: RequestTracker,
  adaptiveController?: AdaptiveController,
): ProxyOrchestrator | undefined {
  const semaphoreScope = semaphoreManager ? new SemaphoreScopeClass(semaphoreManager) : undefined;
  const trackerScope = tracker ? new TrackerScopeClass(tracker) : undefined;
  if (!semaphoreScope || !trackerScope) return undefined;
  return new ProxyOrchestrator({ semaphoreScope, trackerScope, resilience: new ResilienceLayerClass(), adaptiveController });
}

export class ProxyOrchestrator {
  constructor(
    private deps: {
      semaphoreScope: SemaphoreScope;
      trackerScope: TrackerScope;
      resilience: ResilienceLayer;
      adaptiveController?: AdaptiveController;
    },
  ) {}

  async handle(
    request: FastifyRequest,
    reply: FastifyReply,
    apiType: "openai" | "openai-responses" | "anthropic",
    config: OrchestratorConfig,
    ctx?: HandleContext,
  ): Promise<ResilienceResult> {
    const providerId = config.provider.id;
    const controller = new AbortController();
    // 客户端断连时自动 abort（保留原有行为）
    request.raw.on("close", () => {
      if (!request.raw.readableEnded) {
        controller.abort();
      }
    });
    const trackerReq = this.buildActiveRequest(request, config, apiType);
    try {
      const result = await this.deps.trackerScope.track<ResilienceResult>(
        trackerReq,
        () => {
          // kill 回调必须在 tracker.start() 之后注册，确保请求已在 activeMap 中
          this.deps.trackerScope.registerKillCallback(trackerReq.id, () => {
            controller.abort();
            try { reply.raw.destroy(); } catch { /* reply may already be destroyed */ } // eslint-disable-line taste/no-silent-catch
          });
          return this.deps.semaphoreScope.withSlot(
            providerId,
            controller.signal,
            () => {
              trackerReq.queued = true;
              this.deps.trackerScope.markQueued(trackerReq.id, true);
            },
            () => {
              if (trackerReq.queued) {
                trackerReq.queued = false;
                this.deps.trackerScope.markQueued(trackerReq.id, false);
              }
              return this.executeResilience(config, ctx);
            },
            config.concurrencyOverride,
          );
        },
        (result) => this.extractTrackStatus(result),
        (result) => result.attempts.map(a => ({
          statusCode: a.statusCode,
          error: a.error,
          latencyMs: a.latencyMs,
          providerId: a.target.provider_id,
        })),
      );
      const { status, statusCode } = this.extractTrackStatus(result);
      // 如果有重试尝试（非 throw 类型），说明 resilience 层的重试规则匹配了，
      // 意味着这是一个"有意义的失败"——即使上游返回 200 body error 也应该计入退避
      const retryRuleMatched = status === "failed" && result.attempts.length > 1;
      this.deps.adaptiveController?.onRequestComplete(providerId, { success: status === "completed", statusCode, retryRuleMatched, requestId: config.trackerId });
      this.sendResponse(reply, result.result, ctx);
      return result;
    } catch (e) {
      if (e instanceof ProviderSwitchNeeded) {
        const lastResult = e.lastResult;
        const statusCode = lastResult && "statusCode" in lastResult ? lastResult.statusCode : undefined;
        this.deps.adaptiveController?.onRequestComplete(providerId, { success: false, statusCode, retryRuleMatched: true, requestId: config.trackerId });
      } else if (e instanceof SemaphoreTimeoutError || e instanceof SemaphoreQueueFullError) {
        // 信号量超时或队列满：说明并发压力大，上报给自适应控制器
        this.deps.adaptiveController?.onRequestComplete(providerId, { success: false, requestId: config.trackerId });
      }
      throw e;
    }
  }

  private buildActiveRequest(
    request: FastifyRequest,
    config: OrchestratorConfig,
    apiType: "openai" | "openai-responses" | "anthropic",
  ): ActiveRequest {
    return {
      id: config.trackerId ?? crypto.randomUUID(),
      apiType,
      model: config.clientModel,
      providerId: config.provider.id,
      providerName: config.provider.name,
      isStream: config.isStream,
      queued: false,
      startTime: Date.now(),
      status: "pending",
      retryCount: 0,
      attempts: [],
      clientIp: request.ip,
      sessionId: config.sessionId,
      clientRequest: config.clientRequest,
      upstreamRequest: config.upstreamRequest,
    };
  }

  private async executeResilience(
    config: OrchestratorConfig,
    ctx?: HandleContext,
  ): Promise<ResilienceResult> {
    if (!ctx?.transportFn) throw new Error("HandleContext.transportFn is required");
    const resilienceConfig: ResilienceConfig = {
      baseDelayMs: ctx.retryBaseDelayMs ?? DEFAULT_BASE_DELAY_MS,
      failoverThreshold: ctx.failoverThreshold ?? DEFAULT_FAILOVER_THRESHOLD,
      isFailover: ctx.isFailover ?? false,
      ruleMatcher: ctx.ruleMatcher,
    };
    return this.deps.resilience.execute(
      () => [config.resolved],
      ctx.transportFn,
      resilienceConfig,
    );
  }

  private sendResponse(reply: FastifyReply, result: TransportResult, ctx?: HandleContext): void {
    if (result.kind === "stream_success" || result.kind === "stream_abort" || result.kind === "throw") {
      return;
    }
    // stream_error 且 headers 已发送：StreamProxy 已处理响应，无需再次写入
    if (result.kind === "stream_error" && result.headersSent) {
      return;
    }
    // failover 场景下错误响应由外层 proxy-handler 控制，此处不发送
    if (ctx?.isFailover && "statusCode" in result && result.statusCode >= (ctx.failoverThreshold ?? DEFAULT_FAILOVER_THRESHOLD)) {
      return;
    }
    if (result.headers) {
      for (const [key, value] of Object.entries(result.headers)) {
        reply.header(key, value);
      }
    }
    reply.code(result.statusCode).send(result.body);
  }

  private extractTrackStatus(
    result: ResilienceResult,
  ): { status: "completed" | "failed"; statusCode?: number } {
    const transport = result.result;
    if (transport.kind === "success" || transport.kind === "stream_success" || transport.kind === "stream_abort") {
      return { status: "completed", statusCode: transport.statusCode };
    }
    if (transport.kind === "throw") {
      return { status: "failed" };
    }
    return { status: "failed", statusCode: transport.statusCode };
  }
}

import type { FastifyReply, FastifyRequest } from "fastify";
import type { TransportResult } from "./types.js";
import type { Target, ConcurrencyOverride } from "./strategy/types.js";
import type { ResilienceLayer, ResilienceResult, ResilienceConfig } from "./resilience.js";
import { ResilienceLayer as ResilienceLayerClass } from "./resilience.js";
import type { RetryRuleMatcher } from "./retry-rules.js";
import type { SemaphoreScope } from "./scope.js";
import { SemaphoreScope as SemaphoreScopeClass } from "./scope.js";
import type { TrackerScope } from "./scope.js";
import { TrackerScope as TrackerScopeClass } from "./scope.js";
import type { ActiveRequest } from "../monitor/types.js";
import type { ProviderSemaphoreManager } from "./semaphore.js";
import type { RequestTracker } from "../monitor/request-tracker.js";

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
  /** Claude Code 的 session ID，从 x-claude-code-session-id 请求头获取 */
  sessionId?: string;
  /** 客户端请求的 JSON 字符串（headers + body），用于 Monitor 实时查看 */
  clientRequest?: string;
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
  semaphoreManager?: ProviderSemaphoreManager,
  tracker?: RequestTracker,
): ProxyOrchestrator | undefined {
  const semaphoreScope = semaphoreManager ? new SemaphoreScopeClass(semaphoreManager) : undefined;
  const trackerScope = tracker ? new TrackerScopeClass(tracker) : undefined;
  if (!semaphoreScope || !trackerScope) return undefined;
  return new ProxyOrchestrator({ semaphoreScope, trackerScope, resilience: new ResilienceLayerClass() });
}

export class ProxyOrchestrator {
  constructor(
    private deps: {
      semaphoreScope: SemaphoreScope;
      trackerScope: TrackerScope;
      resilience: ResilienceLayer;
    },
  ) {}

  async handle(
    request: FastifyRequest,
    reply: FastifyReply,
    apiType: "openai" | "anthropic",
    config: OrchestratorConfig,
    ctx?: HandleContext,
  ): Promise<ResilienceResult> {
    const trackerReq = this.buildActiveRequest(request, config, apiType);
    const result = await this.deps.trackerScope.track<ResilienceResult>(
      trackerReq,
      () => this.deps.semaphoreScope.withSlot(
        config.provider.id,
        this.createAbortSignal(request),
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
      ),
      (result) => this.extractTrackStatus(result),
      (result) => result.attempts.map(a => ({
        statusCode: a.statusCode,
        error: a.error,
        latencyMs: a.latencyMs,
        providerId: a.target.provider_id,
      })),
    );
    this.sendResponse(reply, result.result, ctx);
    return result;
  }

  private buildActiveRequest(
    request: FastifyRequest,
    config: OrchestratorConfig,
    apiType: "openai" | "anthropic",
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
    };
  }

  private createAbortSignal(request: FastifyRequest): AbortSignal {
    const controller = new AbortController();
    request.raw.on("close", () => {
      if (!request.raw.readableEnded) {
        controller.abort();
      }
    });
    return controller.signal;
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

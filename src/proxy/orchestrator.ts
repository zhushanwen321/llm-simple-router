import type { FastifyReply, FastifyRequest } from "fastify";
import type { TransportResult } from "./types.js";
import type { Target } from "./strategy/types.js";
import type { ResilienceLayer, ResilienceResult, ResilienceConfig } from "./resilience.js";
import type { RetryRuleMatcher } from "./retry-rules.js";
import type { SemaphoreScope } from "./scope.js";
import type { TrackerScope } from "./scope.js";
import type { ActiveRequest } from "../monitor/types.js";

const DEFAULT_MAX_RETRIES = 3;
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
}

export interface HandleContext {
  streamTimeoutMs?: number;
  retryMaxAttempts?: number;
  retryBaseDelayMs?: number;
  failoverThreshold?: number;
  isFailover?: boolean;
  ruleMatcher?: RetryRuleMatcher;
  transportFn: (target: Target) => Promise<TransportResult>;
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
        () => { trackerReq.queued = true; },
        () => this.executeResilience(config, ctx),
      ),
      (result) => this.extractTrackStatus(result),
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
      id: crypto.randomUUID(),
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
      maxRetries: ctx.retryMaxAttempts ?? DEFAULT_MAX_RETRIES,
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
    reply.status(result.statusCode).send(result.body);
  }

  private extractTrackStatus(
    result: ResilienceResult,
  ): { status: "completed" | "failed"; statusCode?: number } {
    const transport = result.result;
    if (transport.kind === "success" || transport.kind === "stream_success") {
      return { status: "completed", statusCode: transport.statusCode };
    }
    if (transport.kind === "throw") {
      return { status: "failed" };
    }
    return { status: "failed", statusCode: transport.statusCode };
  }
}

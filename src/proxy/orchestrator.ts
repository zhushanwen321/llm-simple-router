import type { FastifyReply, FastifyRequest } from "fastify";
import type { TransportResult } from "./types.js";
import type { Target } from "./strategy/types.js";
import type { ResilienceLayer, ResilienceResult, ResilienceConfig } from "./resilience.js";
import type { SemaphoreScope } from "./scope.js";
import type { TrackerScope } from "./scope.js";
import type { ProxyErrorFormatter } from "./proxy-core.js";
import type { ActiveRequest } from "../monitor/types.js";

export interface OrchestratorConfig {
  resolved: Target | null;
  provider: {
    id: string; name: string; is_active: boolean; api_type: string;
    base_url: string; api_key: string;
  } | null;
  isStream: boolean;
}

export interface HandleContext {
  streamTimeoutMs?: number;
  retryMaxAttempts?: number;
  retryBaseDelayMs?: number;
  failoverThreshold?: number;
  isFailover?: boolean;
  beforeSendProxy?: (body: Record<string, unknown>, isStream: boolean) => void;
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
    _upstreamPath: string,
    errors: ProxyErrorFormatter,
    config: OrchestratorConfig,
    ctx?: HandleContext,
  ): Promise<FastifyReply> {
    if (!config.resolved) {
      const err = errors.modelNotFound((request.body as any)?.model ?? "unknown");
      return reply.status(err.statusCode).send(err.body);
    }

    if (!config.provider || !config.provider.is_active) {
      const err = errors.providerUnavailable();
      return reply.status(err.statusCode).send(err.body);
    }

    if (config.provider.api_type !== apiType) {
      const err = errors.providerTypeMismatch();
      return reply.status(err.statusCode).send(err.body);
    }

    const trackerReq = this.buildActiveRequest(request, config, apiType);

    await this.deps.trackerScope.track<ResilienceResult>(
      trackerReq,
      () => this.deps.semaphoreScope.withSlot(
        config.provider!.id,
        this.createAbortSignal(request),
        () => { trackerReq.queued = true; },
        () => this.executeResilience(request, reply, config, ctx),
      ),
      (result) => this.extractTrackStatus(result),
    );
    return reply;
  }

  private buildActiveRequest(
    request: FastifyRequest,
    config: OrchestratorConfig,
    apiType: "openai" | "anthropic",
  ): ActiveRequest {
    return {
      id: crypto.randomUUID(),
      apiType,
      model: (request.body as any)?.model ?? "unknown",
      providerId: config.provider!.id,
      providerName: config.provider!.name,
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
    request: FastifyRequest,
    reply: FastifyReply,
    config: OrchestratorConfig,
    ctx?: HandleContext,
  ): Promise<ResilienceResult> {
    const resilienceConfig: ResilienceConfig = {
      maxRetries: ctx?.retryMaxAttempts ?? 3,
      baseDelayMs: ctx?.retryBaseDelayMs ?? 1000,
      failoverThreshold: ctx?.failoverThreshold ?? 400,
      isFailover: ctx?.isFailover ?? false,
    };

    const result = await this.deps.resilience.execute(
      () => [config.resolved!],
      async (target: Target) => this.callTransport(target, request, config),
      resilienceConfig,
    );

    this.sendResponse(reply, result.result, config.isStream);
    return result;
  }

  private async callTransport(
    target: Target,
    _request: FastifyRequest,
    _config: OrchestratorConfig,
  ): Promise<TransportResult> {
    void target;
    throw new Error("callTransport not yet implemented");
  }

  private sendResponse(
    reply: FastifyReply,
    result: TransportResult,
    isStream: boolean,
  ): void {
    if (result.kind === "stream_success" || result.kind === "stream_abort") {
      return;
    }

    if (result.kind === "throw") {
      return;
    }

    if (isStream && result.kind === "stream_error") {
      if (result.headers) {
        for (const [key, value] of Object.entries(result.headers)) {
          reply.header(key, value);
        }
      }
      reply.status(result.statusCode).send(result.body);
      return;
    }

    if (result.kind === "success" || result.kind === "error") {
      if (result.headers) {
        for (const [key, value] of Object.entries(result.headers)) {
          reply.header(key, value);
        }
      }
      reply.status(result.statusCode).send(result.body);
    }
  }

  private extractTrackStatus(
    result: ResilienceResult,
  ): { status: "completed" | "failed"; statusCode?: number } {
    const transport = result.result;
    if (transport.kind === "success" || transport.kind === "stream_success") {
      return { status: "completed", statusCode: transport.statusCode };
    }
    if ("statusCode" in transport) {
      return { status: "failed", statusCode: transport.statusCode };
    }
    return { status: "failed" };
  }
}

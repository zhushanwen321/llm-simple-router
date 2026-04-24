import { randomUUID } from "crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import Database from "better-sqlite3";
import { getMappingGroup, getProviderById, insertRequestLog } from "../db/index.js";
import { decrypt } from "../utils/crypto.js";
import { getSetting } from "../db/settings.js";
import { resolveMapping } from "./mapping-resolver.js";
import { applyEnhancement, buildModelInfoTag } from "./enhancement-handler.js";
import { SemaphoreQueueFullError, SemaphoreTimeoutError } from "./semaphore.js";
import type { RequestTracker } from "../monitor/request-tracker.js";
import {
  logResilienceResult,
  collectTransportMetrics,
  handleIntercept,
  sanitizeHeadersForLog,
} from "./proxy-logging.js";
import { buildUpstreamHeaders } from "./proxy-core.js";
import { UPSTREAM_SUCCESS, ProviderSwitchNeeded } from "./types.js";
import type { RawHeaders, TransportResult } from "./types.js";
import { SSEMetricsTransform } from "../metrics/sse-metrics-transform.js";
import { MetricsExtractor } from "../metrics/metrics-extractor.js";
import type { MetricsResult } from "../metrics/metrics-extractor.js";
import { updateLogStreamContent } from "../db/index.js";
import { callNonStream, callStream } from "./transport.js";
import { insertRejectedLog } from "./log-helpers.js";
import type { Target } from "./strategy/types.js";
import type { RetryRuleMatcher } from "./retry-rules.js";
import type { ProxyOrchestrator } from "./orchestrator.js";
import type { ProxyErrorFormatter, ProxyErrorResponse } from "./proxy-core.js";

const HTTP_ERROR_THRESHOLD = 400;

// ---------- Helpers ----------

interface RejectParams {
  db: Database.Database;
  logId: string;
  apiType: "openai" | "anthropic";
  model: string;
  startTime: number;
  isStream: boolean;
  routerKeyId: string | null;
  originalBody: Record<string, unknown>;
  clientHeaders: RawHeaders;
  originalModel: string | null;
  isFailover: boolean;
  originalRequestId: string | null;
  sessionId: string | undefined;
}

function rejectAndReply(
  reply: FastifyReply,
  params: RejectParams,
  error: ProxyErrorResponse,
  errorMessage: string,
  providerId?: string,
): FastifyReply {
  insertRejectedLog({
    db: params.db, logId: params.logId, apiType: params.apiType, model: params.model,
    statusCode: error.statusCode, errorMessage, startTime: params.startTime,
    isStream: params.isStream, routerKeyId: params.routerKeyId,
    originalBody: params.originalBody, clientHeaders: params.clientHeaders,
    providerId, originalModel: params.originalModel,
    isFailover: params.isFailover, originalRequestId: params.originalRequestId,
    sessionId: params.sessionId,
  });
  return reply.code(error.statusCode).send(error.body);
}

interface TransportFnParams {
  provider: NonNullable<ReturnType<typeof getProviderById>>;
  apiKey: string;
  body: Record<string, unknown>;
  cliHdrs: RawHeaders;
  reply: FastifyReply;
  upstreamPath: string;
  apiType: "openai" | "anthropic";
  isStream: boolean;
  startTime: number;
  logId: string;
  effectiveModel: string;
  originalModel: string | null;
  streamTimeoutMs: number;
  tracker?: RequestTracker;
  matcher?: RetryRuleMatcher;
  request: FastifyRequest;
}

function buildTransportFn(p: TransportFnParams): (target: Target) => Promise<TransportResult> {
  return async (_target: Target) => {
    if (p.isStream) {
      const metricsTransform = new SSEMetricsTransform(p.apiType, p.startTime, {
        onMetrics: (m) => { p.tracker?.update(p.logId, { streamMetrics: toStreamMetrics(m) }); },
        onChunk: (rawLine) => { p.tracker?.appendStreamChunk(p.logId, rawLine, p.apiType, STREAM_CONTENT_MAX_RAW, STREAM_CONTENT_MAX_TEXT); },
      });
      const checkEarlyError = p.matcher ? (data: string) => p.matcher!.test(UPSTREAM_SUCCESS, data) : undefined;
      const streamResult = await callStream(
        p.provider, p.apiKey, p.body, p.cliHdrs, p.reply, p.streamTimeoutMs,
        p.upstreamPath, buildUpstreamHeaders, metricsTransform, checkEarlyError,
      );
      const m = (streamResult.kind === "stream_success" || streamResult.kind === "stream_abort")
        ? streamResult.metrics : undefined;
      if (m) p.tracker?.update(p.logId, { streamMetrics: toStreamMetrics(m) });
      return streamResult;
    }
    const result = await callNonStream(p.provider, p.apiKey, p.body, p.cliHdrs, p.upstreamPath, buildUpstreamHeaders);
    if (result.kind === "success") {
      const mr = MetricsExtractor.fromNonStreamResponse(p.apiType, result.body);
      if (mr) p.tracker?.update(p.logId, { streamMetrics: toStreamMetrics(mr) });
    }
    if (p.originalModel && result.kind === "success" && result.statusCode === UPSTREAM_SUCCESS) {
      try {
        const bodyObj = JSON.parse(result.body);
        if (bodyObj.content?.[0]?.text) {
          bodyObj.content[0].text += `\n\n${buildModelInfoTag(p.effectiveModel)}`;
          return { ...result, body: JSON.stringify(bodyObj) };
        }
      } catch { p.request.log.debug("Failed to inject model-info tag into non-JSON response"); }
    }
    return result;
  };
}

export interface RouteHandlerDeps {
  db: Database.Database;
  streamTimeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  matcher?: RetryRuleMatcher;
  tracker?: RequestTracker;
  orchestrator: ProxyOrchestrator;
}

const STREAM_CONTENT_MAX_RAW = 131072;
const STREAM_CONTENT_MAX_TEXT = 65536;

import type { ContentBlock } from "../monitor/types.js";

/** 将 tracker blocks 序列化为前端 tryDirectParse 可解析的 JSON */
function serializeBlocksForStorage(blocks: ContentBlock[] | undefined, apiType: "openai" | "anthropic"): string {
  if (!blocks || blocks.length === 0) return "";
  if (apiType === "anthropic") {
    const content = blocks.map(b => {
      if (b.type === "thinking") return { type: "thinking", thinking: b.content };
      if (b.type === "tool_use") {
        let input = {};
        try { input = JSON.parse(b.content || "{}"); } catch { /* eslint-disable-line taste/no-silent-catch -- tool_use content 非合法 JSON 时保留空对象 */ }
        return { type: "tool_use", name: b.name ?? "", input };
      }
      return { type: "text", text: b.content };
    });
    return JSON.stringify({ content });
  }
  const text = blocks.filter(b => b.type === "text").map(b => b.content).join("");
  return JSON.stringify({ choices: [{ message: { content: text } }] });
}

function toStreamMetrics(m: MetricsResult) {
  return {
    inputTokens: m.input_tokens,
    outputTokens: m.output_tokens,
    cacheReadTokens: m.cache_read_tokens,
    ttftMs: m.ttft_ms,
    tokensPerSecond: m.tokens_per_second,
    stopReason: m.stop_reason,
    isComplete: m.is_complete === 1,
  };
}

export async function handleProxyRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  apiType: "openai" | "anthropic",
  upstreamPath: string,
  errors: ProxyErrorFormatter,
  deps: RouteHandlerDeps,
  options?: {
    beforeSendProxy?: (body: Record<string, unknown>, isStream: boolean) => void;
  },
): Promise<FastifyReply> {
  request.raw.socket.on("error", (err) => request.log.debug({ err }, "client socket error"));
  const clientModel = ((request.body as Record<string, unknown>).model as string) || "unknown";
  const sessionId = (request.headers as RawHeaders)["x-claude-code-session-id"] as string | undefined;
  const { effectiveModel, originalModel, interceptResponse } = applyEnhancement(deps.db, request, clientModel, sessionId);

  if (interceptResponse) return handleIntercept(deps.db, apiType, request, reply, interceptResponse, clientModel, sessionId);

  const group = getMappingGroup(deps.db, effectiveModel);
  const isFailover = group?.strategy === "failover";
  const excludeTargets: Target[] = [];
  const originalBody = JSON.parse(JSON.stringify(request.body as Record<string, unknown>));
  let rootLogId: string | null = null;

  while (true) {
    const startTime = Date.now();
    const logId = randomUUID();
    if (rootLogId === null) rootLogId = logId;
    const isFailoverIteration = rootLogId !== logId;
    const routerKeyId = request.routerKey?.id ?? null;
    const body = request.body as Record<string, unknown>;
    const isStream = body.stream === true;
    const cliHdrs: RawHeaders = request.headers as RawHeaders;

    const rCtx: RejectParams = {
      db: deps.db, logId, apiType, model: effectiveModel,
      startTime, isStream, routerKeyId, originalBody, clientHeaders: cliHdrs, originalModel,
      isFailover: isFailoverIteration, originalRequestId: isFailoverIteration ? rootLogId : null, sessionId,
    };

    const resolved = resolveMapping(deps.db, effectiveModel, { now: new Date(), excludeTargets });
    request.log.debug({ logId, model: effectiveModel, apiType, isStream, action: "resolve_mapping", resolved: !!resolved });

    if (!resolved) {
      if (isFailover && excludeTargets.length > 0) {
        return rejectAndReply(reply, { ...rCtx, isFailover: true, originalRequestId: rootLogId },
          errors.upstreamConnectionFailed(), `All failover targets exhausted (${excludeTargets.length} attempted)`);
      }
      return rejectAndReply(reply, rCtx, errors.modelNotFound(effectiveModel), `No mapping found for model '${effectiveModel}'`);
    }

    if (excludeTargets.length === 0) {
      const allowedModels = request.routerKey?.allowed_models;
      if (allowedModels) {
        try {
          const models: string[] = JSON.parse(allowedModels).filter((m: string) => m.trim() !== "");
          if (models.length > 0 && !models.includes(resolved.backend_model)) {
            return rejectAndReply(reply, rCtx, errors.modelNotAllowed(resolved.backend_model),
              `Model '${resolved.backend_model}' not allowed`, resolved.provider_id);
          }
        } catch { request.log.warn({ allowedModels: allowedModels?.slice(0, 80) }, "Invalid allowed_models JSON, allowing all models"); } // eslint-disable-line no-magic-numbers
      }
    }

    const provider = getProviderById(deps.db, resolved.provider_id);
    if (!provider || !provider.is_active) {
      return rejectAndReply(reply, rCtx, errors.providerUnavailable(),
        `Provider '${resolved.provider_id}' unavailable`, resolved.provider_id);
    }
    if (provider.api_type !== apiType) {
      return rejectAndReply(reply, rCtx, errors.providerTypeMismatch(),
        `API type mismatch: expected '${apiType}'`, resolved.provider_id);
    }

    body.model = resolved.backend_model;
    const apiKey = decrypt(provider.api_key, getSetting(deps.db, "encryption_key")!);
    options?.beforeSendProxy?.(body, isStream);

    const reqBodyStr = JSON.stringify(body);
    const clientReq = JSON.stringify({ headers: cliHdrs, body: originalBody });
    const upstreamReqBase = JSON.stringify({
      url: `${provider.base_url}${upstreamPath}`,
      headers: sanitizeHeadersForLog(buildUpstreamHeaders(cliHdrs, apiKey, Buffer.byteLength(reqBodyStr))),
      body: reqBodyStr,
    });

    const transportFn = buildTransportFn({
      provider, apiKey, body, cliHdrs, reply, upstreamPath, apiType,
      isStream, startTime, logId, effectiveModel, originalModel,
      streamTimeoutMs: deps.streamTimeoutMs, tracker: deps.tracker, matcher: deps.matcher, request,
    });

    try {
      const resilienceResult = await deps.orchestrator.handle(
        request, reply, apiType,
        { resolved, provider, clientModel: effectiveModel, isStream, trackerId: logId, sessionId, clientRequest: clientReq },
        { retryMaxAttempts: deps.retryMaxAttempts, retryBaseDelayMs: deps.retryBaseDelayMs, isFailover, ruleMatcher: deps.matcher, transportFn },
      );
      const lastLogId = logResilienceResult(
        deps.db,
        {
          apiType, model: effectiveModel, providerId: provider.id, isStream,
          clientReq, upstreamReqBase, logId, routerKeyId, originalModel, sessionId,
          failover: { isFailoverIteration, rootLogId: rootLogId! },
        },
        resilienceResult.attempts, resilienceResult.result, startTime,
      );
      collectTransportMetrics(deps.db, apiType, resilienceResult.result, isStream, lastLogId, provider.id, resolved.backend_model, request);

      if (isStream && deps.tracker) {
        const sc = deps.tracker.get(logId)?.streamContent;
        const blocks = sc?.blocks;
        const hasStructured = blocks && blocks.length > 0 && blocks.some(b => b.type !== "text");
        const content = hasStructured
          ? serializeBlocksForStorage(blocks, apiType)
          : (sc?.textContent || "");
        if (content) updateLogStreamContent(deps.db, lastLogId, content);
      }

      if (isFailover && !reply.raw.headersSent) {
        const tr = resilienceResult.result;
        const failed = tr.kind === "throw"
          || ("statusCode" in tr && tr.statusCode >= HTTP_ERROR_THRESHOLD);
        if (failed) {
          excludeTargets.push(resolved);
          continue;
        }
      }

      if (!reply.raw.headersSent) {
        const tr = resilienceResult.result;
        if (tr.kind === "throw" || (tr.kind === "error" && tr.statusCode >= HTTP_ERROR_THRESHOLD)) {
          const err = errors.upstreamConnectionFailed();
          return reply.code(err.statusCode).send(err.body);
        }
      }

      return reply;
    } catch (e) {
      if (e instanceof ProviderSwitchNeeded) {
        request.log.debug({ logId, action: "provider_switch", targetProviderId: e.targetProviderId });
        excludeTargets.push(resolved);
        continue;
      }
      if (e instanceof SemaphoreQueueFullError) {
        return rejectAndReply(reply, rCtx, errors.concurrencyQueueFull(provider.id),
          `Concurrency queue full for provider '${provider.id}'`, provider.id);
      }
      if (e instanceof SemaphoreTimeoutError) {
        return rejectAndReply(reply, rCtx, errors.concurrencyTimeout(provider.id, e.timeoutMs),
          `Concurrency wait timeout for provider '${provider.id}' (${e.timeoutMs}ms)`, provider.id);
      }
      const errMsg = e instanceof Error ? e.message : String(e);
      request.log.debug({ logId, error: errMsg, action: "upstream_error" });
      insertRequestLog(deps.db, {
        id: logId, api_type: apiType, model: effectiveModel, provider_id: provider.id,
        status_code: 502, latency_ms: Date.now() - startTime, is_stream: isStream ? 1 : 0,
        error_message: errMsg || "Upstream connection failed", created_at: new Date().toISOString(),
        client_request: clientReq, upstream_request: upstreamReqBase,
        is_failover: isFailoverIteration ? 1 : 0, original_request_id: isFailoverIteration ? rootLogId : null,
        router_key_id: routerKeyId, original_model: originalModel,
        session_id: sessionId,
      });
      const err = errors.upstreamConnectionFailed();
      return reply.code(err.statusCode).send(err.body);
    }
  }
}

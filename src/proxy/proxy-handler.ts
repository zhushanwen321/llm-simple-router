import { randomUUID } from "crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import Database from "better-sqlite3";
import { getMappingGroup, getProviderById, insertRequestLog } from "../db/index.js";
import { decrypt } from "../utils/crypto.js";
import { getSetting } from "../db/settings.js";
import { resolveMapping } from "./mapping-resolver.js";
import { applyEnhancement } from "./enhancement/enhancement-handler.js";
import { SemaphoreQueueFullError, SemaphoreTimeoutError } from "./semaphore.js";
import type { RequestTracker } from "../monitor/request-tracker.js";
import {
  logResilienceResult,
  collectTransportMetrics,
  handleIntercept,
  sanitizeHeadersForLog,
} from "./proxy-logging.js";
import { buildUpstreamHeaders, buildUpstreamUrl } from "./proxy-core.js";
import { ProviderSwitchNeeded } from "./types.js";
import type { RawHeaders, TransportResult } from "./types.js";
import { updateLogStreamContent, updateLogClientStatus } from "../db/index.js";
import { insertRejectedLog } from "./log-helpers.js";
import type { Target } from "./strategy/types.js";
import type { RetryRuleMatcher } from "./retry-rules.js";
import type { ProxyOrchestrator } from "./orchestrator.js";
import type { ProxyErrorFormatter, ProxyErrorResponse } from "./proxy-core.js";
import { buildTransportFn } from "./transport-fn.js";
import { applyOverflowRedirect } from "./overflow.js";
import { applyProviderPatches } from "./patch/index.js";

const HTTP_ERROR_THRESHOLD = 400;
const MAX_LOG_FIELD_LENGTH = 80;
const UPSTREAM_ERROR_STATUS = 502;

/** 从 TransportResult 中提取最终 HTTP status code */
function getTransportStatusCode(result: TransportResult): number | null {
  if (result.kind === "success" || result.kind === "error" || result.kind === "stream_error") return result.statusCode;
  if (result.kind === "stream_success" || result.kind === "stream_abort") return result.statusCode;
  // kind === "throw"：无 HTTP 状态码
  return null;
}

// ---------- Failover loop context ----------

interface FailoverContext {
  request: FastifyRequest;
  reply: FastifyReply;
  apiType: "openai" | "anthropic";
  upstreamPath: string;
  errors: ProxyErrorFormatter;
  deps: RouteHandlerDeps;
  options?: { beforeSendProxy?: (body: Record<string, unknown>, isStream: boolean) => void };
  effectiveModel: string;
  originalModel: string | null;
  isFailover: boolean;
  originalBody: Record<string, unknown>;
  sessionId: string | undefined;
}

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

export interface RouteHandlerDeps {
  db: Database.Database;
  streamTimeoutMs: number;
  retryBaseDelayMs: number;
  matcher?: RetryRuleMatcher;
  tracker?: RequestTracker;
  orchestrator: ProxyOrchestrator;
  usageWindowTracker?: import("./usage-window-tracker.js").UsageWindowTracker;
}

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

// ---------- Main entry ----------

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
  return executeFailoverLoop({
    request, reply, apiType, upstreamPath, errors, deps, options,
    effectiveModel, originalModel,
    isFailover: group?.strategy === "failover",
    originalBody: JSON.parse(JSON.stringify(request.body as Record<string, unknown>)),
    sessionId,
  });
}

// ---------- Failover loop ----------

async function executeFailoverLoop(ctx: FailoverContext): Promise<FastifyReply> {
  const { request, reply, apiType, upstreamPath, errors, deps, options, effectiveModel, originalModel, isFailover, originalBody, sessionId } = ctx;
  const excludeTargets: Target[] = [];
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

    let resolved = resolveMapping(deps.db, effectiveModel, { now: new Date(), excludeTargets });
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
        } catch { request.log.warn({ allowedModels: allowedModels?.slice(0, MAX_LOG_FIELD_LENGTH) }, "Invalid allowed_models JSON, allowing all models"); }
      }
    }

    let provider = getProviderById(deps.db, resolved.provider_id);
    if (!provider || !provider.is_active) {
      return rejectAndReply(reply, rCtx, errors.providerUnavailable(),
        `Provider '${resolved.provider_id}' unavailable`, resolved.provider_id);
    }
    if (provider.api_type !== apiType) {
      return rejectAndReply(reply, rCtx, errors.providerTypeMismatch(),
        `API type mismatch: expected '${apiType}'`, resolved.provider_id);
    }

    body.model = resolved.backend_model;

    // --- 溢出重定向：上下文超出时切换到更大模型 ---
    const overflowResult = applyOverflowRedirect(resolved, deps.db, body);
    if (overflowResult) {
      const overflowProvider = getProviderById(deps.db, overflowResult.provider_id);
      if (overflowProvider && overflowProvider.is_active && overflowProvider.api_type === apiType) {
        resolved = { ...resolved, provider_id: overflowResult.provider_id, backend_model: overflowResult.backend_model };
        provider = overflowProvider;
        body.model = overflowResult.backend_model;
      }
    }

    applyProviderPatches(body, provider);
    const apiKey = decrypt(provider.api_key, getSetting(deps.db, "encryption_key")!);
    options?.beforeSendProxy?.(body, isStream);

    const reqBodyStr = JSON.stringify(body);
    const clientReq = JSON.stringify({ headers: cliHdrs, body: originalBody });
    const upstreamReqBase = JSON.stringify({
      url: buildUpstreamUrl(provider.base_url, upstreamPath),
      headers: sanitizeHeadersForLog(buildUpstreamHeaders(cliHdrs, apiKey, Buffer.byteLength(reqBodyStr), apiType)),
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
        { retryBaseDelayMs: deps.retryBaseDelayMs, isFailover, ruleMatcher: deps.matcher, transportFn },
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
      collectTransportMetrics(deps.db, apiType, resilienceResult.result, isStream, lastLogId, provider.id, resolved.backend_model, request, routerKeyId, getTransportStatusCode(resilienceResult.result));

      const tr = resilienceResult.result;
      const succeeded = tr.kind === "success" || tr.kind === "stream_success" || tr.kind === "stream_abort";
      if (succeeded) deps.usageWindowTracker?.recordRequest(routerKeyId ?? undefined);

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

      // orchestrator.sendResponse 对 throw/stream_success/stream_abort 不发送，
      // 对 failover 场景的错误也不发送——这些情况需要外层 proxy-handler 处理
      if (!reply.raw.headersSent) {
        const tr = resilienceResult.result;
        if (tr.kind === "throw" || (tr.kind === "error" && tr.statusCode >= HTTP_ERROR_THRESHOLD)) {
          const err = errors.upstreamConnectionFailed();
          updateLogClientStatus(deps.db, lastLogId, err.statusCode);
          return reply.code(err.statusCode).send(err.body);
        }
      }

      return reply;
    } catch (e) {
      if (e instanceof ProviderSwitchNeeded) {
        // 跨 provider failover：resilience 层携带了 attempts 数据，补写失败日志
        if (e.attempts && e.attempts.length > 0) {
          const fakeResult = e.lastResult ?? { kind: "throw" as const, error: new Error("provider switch") };
          logResilienceResult(
            deps.db,
            {
              apiType, model: effectiveModel, providerId: provider.id, isStream,
              clientReq, upstreamReqBase, logId, routerKeyId, originalModel, sessionId,
              failover: { isFailoverIteration, rootLogId: rootLogId! },
            },
            e.attempts, fakeResult, startTime,
          );
        }
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
        status_code: UPSTREAM_ERROR_STATUS, latency_ms: Date.now() - startTime, is_stream: isStream ? 1 : 0,
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

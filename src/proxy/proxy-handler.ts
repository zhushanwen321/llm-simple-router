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
import { updateLogStreamContent } from "../db/index.js";
import { callNonStream, callStream } from "./transport.js";
import { insertRejectedLog } from "./log-helpers.js";
import type { Target } from "./strategy/types.js";
import type { RetryRuleMatcher } from "./retry-rules.js";
import type { ProxyOrchestrator } from "./orchestrator.js";
import type { ProxyErrorFormatter } from "./proxy-core.js";

const HTTP_ERROR_THRESHOLD = 400;

export interface RouteHandlerDeps {
  db: Database.Database;
  streamTimeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  matcher?: RetryRuleMatcher;
  tracker?: RequestTracker;
  orchestrator: ProxyOrchestrator;
}

const STREAM_CONTENT_MAX_RAW = 8192;
const STREAM_CONTENT_MAX_TEXT = 4096;

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

    const resolved = resolveMapping(deps.db, effectiveModel, { now: new Date(), excludeTargets });
    request.log.debug({ logId, model: effectiveModel, apiType, isStream, action: "resolve_mapping", resolved: !!resolved });

    if (!resolved) {
      if (isFailover && excludeTargets.length > 0) {
        const e = errors.upstreamConnectionFailed();
        insertRejectedLog({
          db: deps.db, logId, apiType, model: effectiveModel, statusCode: e.statusCode,
          errorMessage: `All failover targets exhausted (${excludeTargets.length} attempted)`,
          startTime, isStream, routerKeyId, originalBody, clientHeaders: cliHdrs, originalModel,
          isFailover: true, originalRequestId: rootLogId, sessionId,
        });
        return reply.status(e.statusCode).send(e.body);
      }
      const e = errors.modelNotFound(effectiveModel);
      insertRejectedLog({
        db: deps.db, logId, apiType, model: effectiveModel, statusCode: e.statusCode,
        errorMessage: `No mapping found for model '${effectiveModel}'`, startTime, isStream,
        routerKeyId, originalBody, clientHeaders: cliHdrs, originalModel,
        isFailover: isFailoverIteration, originalRequestId: isFailoverIteration ? rootLogId : null, sessionId,
      });
      return reply.status(e.statusCode).send(e.body);
    }

    if (excludeTargets.length === 0) {
      const allowedModels = request.routerKey?.allowed_models;
      if (allowedModels) {
        try {
          const models: string[] = JSON.parse(allowedModels).filter((m: string) => m.trim() !== "");
          if (models.length > 0 && !models.includes(resolved.backend_model)) {
            const e = errors.modelNotAllowed(resolved.backend_model);
            insertRejectedLog({
              db: deps.db, logId, apiType, model: effectiveModel, statusCode: e.statusCode,
              errorMessage: `Model '${resolved.backend_model}' not allowed`, startTime, isStream, routerKeyId,
              originalBody, clientHeaders: cliHdrs, providerId: resolved.provider_id, originalModel,
              isFailover: isFailoverIteration, originalRequestId: isFailoverIteration ? rootLogId : null, sessionId,
            });
            return reply.status(e.statusCode).send(e.body);
          }
        } catch { request.log.warn({ allowedModels: allowedModels?.slice(0, 80) }, "Invalid allowed_models JSON, allowing all models"); } // eslint-disable-line no-magic-numbers
      }
    }

    const provider = getProviderById(deps.db, resolved.provider_id);
    if (!provider || !provider.is_active) {
      const e = errors.providerUnavailable();
      insertRejectedLog({
        db: deps.db, logId, apiType, model: effectiveModel, statusCode: e.statusCode,
        errorMessage: `Provider '${resolved.provider_id}' unavailable`, startTime, isStream, routerKeyId,
        originalBody, clientHeaders: cliHdrs, providerId: resolved.provider_id, originalModel,
        isFailover: isFailoverIteration, originalRequestId: isFailoverIteration ? rootLogId : null, sessionId,
      });
      return reply.status(e.statusCode).send(e.body);
    }
    if (provider.api_type !== apiType) {
      const e = errors.providerTypeMismatch();
      insertRejectedLog({
        db: deps.db, logId, apiType, model: effectiveModel, statusCode: e.statusCode,
        errorMessage: `API type mismatch: expected '${apiType}'`, startTime, isStream, routerKeyId,
        originalBody, clientHeaders: cliHdrs, providerId: resolved.provider_id, originalModel,
        isFailover: isFailoverIteration, originalRequestId: isFailoverIteration ? rootLogId : null, sessionId,
      });
      return reply.status(e.statusCode).send(e.body);
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

    // transportFn 闭包捕获当前迭代的 provider/apiKey/headers/body/reply 上下文
    // target 由 resilience 层传入但当前架构下 provider 已在闭包中确定
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const transportFn = async (_target: Target): Promise<TransportResult> => {
      if (isStream) {
        const metricsTransform = new SSEMetricsTransform(apiType, startTime, {
          onMetrics: (m) => {
            deps.tracker?.update(logId, {
              streamMetrics: {
                inputTokens: m.input_tokens, outputTokens: m.output_tokens,
                cacheReadTokens: m.cache_read_tokens,
                ttftMs: m.ttft_ms, tokensPerSecond: m.tokens_per_second,
                stopReason: m.stop_reason, isComplete: m.is_complete === 1,
              },
            });
          },
          onChunk: (rawLine) => {
            deps.tracker?.appendStreamChunk(logId, rawLine, apiType, STREAM_CONTENT_MAX_RAW, STREAM_CONTENT_MAX_TEXT);
          },
        });
        const checkEarlyError = deps.matcher
          ? (data: string) => deps.matcher!.test(UPSTREAM_SUCCESS, data)
          : undefined;
        return callStream(
          provider, apiKey, body, cliHdrs, reply, deps.streamTimeoutMs,
          upstreamPath, buildUpstreamHeaders, metricsTransform, checkEarlyError,
        );
      }
      const result = await callNonStream(provider, apiKey, body, cliHdrs, upstreamPath, buildUpstreamHeaders);
      // 非流式请求：从响应体提取指标并更新 tracker
      if (result.kind === "success") {
        const mr = MetricsExtractor.fromNonStreamResponse(apiType, result.body);
        if (mr) {
          deps.tracker?.update(logId, {
            streamMetrics: {
              inputTokens: mr.input_tokens, outputTokens: mr.output_tokens,
              cacheReadTokens: mr.cache_read_tokens,
              ttftMs: mr.ttft_ms, tokensPerSecond: mr.tokens_per_second,
              stopReason: mr.stop_reason, isComplete: mr.is_complete === 1,
            },
          });
        }
      }
      // 非流式响应注入模型信息标签（模型映射场景）
      if (originalModel && result.kind === "success" && result.statusCode === UPSTREAM_SUCCESS) {
        try {
          const bodyObj = JSON.parse(result.body);
          if (bodyObj.content?.[0]?.text) {
            bodyObj.content[0].text += `\n\n${buildModelInfoTag(effectiveModel)}`;
            return { ...result, body: JSON.stringify(bodyObj) };
          }
        } catch { request.log.debug("Failed to inject model-info tag into non-JSON response"); }
      }
      return result;
    };

    try {
      const resilienceResult = await deps.orchestrator.handle(
        request, reply, apiType,
        { resolved, provider, clientModel: effectiveModel, isStream, trackerId: logId, sessionId },
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

      // 流式请求：将 tracker 中累积的文本内容持久化到日志
      if (isStream && deps.tracker) {
        const req = deps.tracker.get(lastLogId);
        const text = req?.streamContent?.textContent;
        if (text) updateLogStreamContent(deps.db, lastLogId, text);
      }

      // Failover: 单 provider 内重试已耗尽但仍失败，尝试下一个 target
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
      // 对非 failover 的 error/throw 需要由外层发送错误响应
      if (!reply.raw.headersSent) {
        const tr = resilienceResult.result;
        if (tr.kind === "throw" || (tr.kind === "error" && tr.statusCode >= HTTP_ERROR_THRESHOLD)) {
          const err = errors.upstreamConnectionFailed();
          return reply.status(err.statusCode).send(err.body);
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
        const err = errors.concurrencyQueueFull(provider.id);
        insertRejectedLog({
          db: deps.db, logId, apiType, model: effectiveModel, statusCode: err.statusCode,
          errorMessage: `Concurrency queue full for provider '${provider.id}'`,
          startTime, isStream, routerKeyId, originalBody, clientHeaders: cliHdrs,
          providerId: provider.id, originalModel,
          isFailover: isFailoverIteration, originalRequestId: isFailoverIteration ? rootLogId : null, sessionId,
        });
        return reply.status(err.statusCode).send(err.body);
      }
      if (e instanceof SemaphoreTimeoutError) {
        const err = errors.concurrencyTimeout(provider.id, e.timeoutMs);
        insertRejectedLog({
          db: deps.db, logId, apiType, model: effectiveModel, statusCode: err.statusCode,
          errorMessage: `Concurrency wait timeout for provider '${provider.id}' (${e.timeoutMs}ms)`,
          startTime, isStream, routerKeyId, originalBody, clientHeaders: cliHdrs,
          providerId: provider.id, originalModel,
          isFailover: isFailoverIteration, originalRequestId: isFailoverIteration ? rootLogId : null, sessionId,
        });
        return reply.status(err.statusCode).send(err.body);
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
      return reply.status(err.statusCode).send(err.body);
    }
  }
}

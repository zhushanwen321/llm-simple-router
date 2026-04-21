import { randomUUID } from "crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import Database from "better-sqlite3";
import type { Provider } from "../db/index.js";
import { getProviderById, insertRequestLog, insertMetrics } from "../db/index.js";
import { decrypt } from "../utils/crypto.js";
import { getSetting } from "../db/settings.js";
import { MetricsExtractor } from "../metrics/metrics-extractor.js";
import { getMappingGroup } from "../db/index.js";
import { resolveMapping } from "./mapping-resolver.js";
import { retryableCall, buildRetryConfig, type Attempt } from "./retry.js";
import type { RetryRuleMatcher } from "./retry-rules.js";
import type { Target } from "./strategy/types.js";
import { SSEMetricsTransform } from "../metrics/sse-metrics-transform.js";
import {
  proxyNonStream as upstreamNonStream,
  proxyStream as upstreamStream,
  proxyGetRequest as upstreamGet,
  type ProxyResult,
  type StreamProxyResult,
  type GetProxyResult,
} from "./upstream-call.js";
import { insertSuccessLog, insertRejectedLog } from "./log-helpers.js";
import { applyEnhancement, buildModelInfoTag } from "./enhancement-handler.js";
import { ProviderSemaphoreManager, SemaphoreQueueFullError, SemaphoreTimeoutError } from "./semaphore.js";
import type { RequestTracker } from "../monitor/request-tracker.js";

// ---------- Types ----------

export type RawHeaders = Record<string, string | string[] | undefined>;

export interface ProxyErrorResponse {
  statusCode: number;
  body: unknown;
}

export interface ProxyErrorFormatter {
  modelNotFound(model: string): ProxyErrorResponse;
  modelNotAllowed(model: string): ProxyErrorResponse;
  providerUnavailable(): ProxyErrorResponse;
  providerTypeMismatch(): ProxyErrorResponse;
  upstreamConnectionFailed(): ProxyErrorResponse;
  concurrencyQueueFull(providerId: string): ProxyErrorResponse;
  concurrencyTimeout(providerId: string, timeoutMs: number): ProxyErrorResponse;
}

export interface ProxyHandlerDeps {
  db: Database.Database;
  streamTimeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  matcher?: RetryRuleMatcher;
  semaphoreManager?: ProviderSemaphoreManager;
  tracker?: RequestTracker;
}

// Re-export upstream types for external consumers
export type { ProxyResult, StreamProxyResult, GetProxyResult };

// ---------- Constants ----------

const UPSTREAM_SUCCESS = 200;
const FAILOVER_FAIL_THRESHOLD = 400;
const STREAM_CONTENT_MAX_RAW = 8192;
const STREAM_CONTENT_MAX_TEXT = 4096;

// ---------- Header utilities ----------

export const SKIP_UPSTREAM = new Set([
  "host",
  "content-length",
  "accept-encoding",
  "authorization",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
]);

export function selectHeaders(
  raw: RawHeaders,
  skip: Set<string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value == null || skip.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

// 当前两个 provider 都使用 Bearer token
// 如果未来需要支持其他鉴权方式，需要参数化 header 构造
export function buildUpstreamHeaders(
  clientHeaders: RawHeaders,
  apiKey: string,
  payloadBytes?: number
): Record<string, string> {
  const headers = selectHeaders(clientHeaders, SKIP_UPSTREAM);
  headers["Authorization"] = `Bearer ${apiKey}`;
  if (payloadBytes !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(payloadBytes);
  }
  return headers;
}

// ---------- GET proxy (thin wrapper) ----------

export function proxyGetRequest(
  backend: Provider,
  apiKey: string,
  clientHeaders: RawHeaders,
  upstreamPath: string
): Promise<GetProxyResult> {
  return upstreamGet(backend, apiKey, clientHeaders, upstreamPath, buildUpstreamHeaders);
}

// ---------- Helper functions for handleProxyPost ----------

function handleIntercept(
  db: Database.Database,
  apiType: "openai" | "anthropic",
  request: FastifyRequest,
  reply: FastifyReply,
  interceptResponse: { statusCode: number; body: unknown; meta?: unknown },
  clientModel: string,
): FastifyReply {
  const logId = randomUUID();
  const isStream = (request.body as Record<string, unknown>).stream === true;
  const respBody = JSON.stringify(interceptResponse.body);
  insertRequestLog(db, {
    id: logId, api_type: apiType, model: clientModel, provider_id: "router",
    status_code: interceptResponse.statusCode, latency_ms: 0,
    is_stream: isStream ? 1 : 0, error_message: null,
    created_at: new Date().toISOString(),
    request_body: JSON.stringify(request.body),
    response_body: respBody,
    client_request: JSON.stringify({ headers: request.headers as RawHeaders, body: request.body }),
    upstream_request: interceptResponse.meta ? JSON.stringify(interceptResponse.meta) : null,
    client_response: JSON.stringify({ statusCode: interceptResponse.statusCode, body: respBody }),
    is_retry: 0, is_failover: 0, original_request_id: null,
    router_key_id: request.routerKey?.id ?? null, original_model: null,
  });
  return reply.status(interceptResponse.statusCode).send(interceptResponse.body);
}

function logRetryAttempts(
  db: Database.Database,
  params: {
    apiType: "openai" | "anthropic";
    model: string;
    providerId: string;
    isStream: boolean;
    reqBodyStr: string;
    clientReq: string;
    upstreamReqBase: string;
    logId: string;
    routerKeyId: string | null;
    originalModel: string | null;
    isFailoverIteration: boolean;
    rootLogId: string;
  },
  attempts: Attempt[],
  result: ProxyResult | StreamProxyResult,
  startTime: number,
): string {
  let lastSuccessLogId = params.logId;
  for (const attempt of attempts) {
    const isOriginal = attempt.attemptIndex === 0;
    const attemptLogId = isOriginal ? params.logId : randomUUID();

    if (attempt.error) {
      insertRequestLog(db, {
        id: attemptLogId, api_type: params.apiType, model: params.model, provider_id: params.providerId,
        status_code: HTTP_BAD_GATEWAY, latency_ms: attempt.latencyMs,
        is_stream: params.isStream ? 1 : 0, error_message: attempt.error,
        created_at: new Date().toISOString(), request_body: params.reqBodyStr,
        client_request: params.clientReq, upstream_request: params.upstreamReqBase,
        is_retry: isOriginal ? 0 : 1,
        is_failover: (isOriginal && params.isFailoverIteration) ? 1 : 0,
        original_request_id: isOriginal ? (params.isFailoverIteration ? params.rootLogId : null) : params.logId,
        router_key_id: params.routerKeyId, original_model: params.originalModel,
      });
    } else if (attempt.statusCode !== UPSTREAM_SUCCESS) {
      insertRequestLog(db, {
        id: attemptLogId, api_type: params.apiType, model: params.model, provider_id: params.providerId,
        status_code: attempt.statusCode!, latency_ms: attempt.latencyMs,
        is_stream: params.isStream ? 1 : 0, error_message: null,
        created_at: new Date().toISOString(), request_body: params.reqBodyStr,
        response_body: attempt.responseBody, client_request: params.clientReq, upstream_request: params.upstreamReqBase,
        upstream_response: JSON.stringify({ statusCode: attempt.statusCode, body: attempt.responseBody }),
        client_response: JSON.stringify({ statusCode: attempt.statusCode, body: attempt.responseBody }),
        is_retry: isOriginal ? 0 : 1,
        is_failover: (isOriginal && params.isFailoverIteration) ? 1 : 0,
        original_request_id: isOriginal ? (params.isFailoverIteration ? params.rootLogId : null) : params.logId,
        router_key_id: params.routerKeyId, original_model: params.originalModel,
      });
    } else {
      const h = params.isStream
        ? ((result as StreamProxyResult).upstreamResponseHeaders ?? {})
        : ((result as ProxyResult).headers);
      insertSuccessLog(db, { apiType: params.apiType, model: params.model, provider: { id: params.providerId } as Provider, isStream: params.isStream, startTime,
        reqBody: params.reqBodyStr, clientReq: params.clientReq, upstreamReq: params.upstreamReqBase, id: attemptLogId,
        status: result.statusCode, respBody: attempt.responseBody, upHdrs: h, cliHdrs: h,
        isRetry: !isOriginal, isFailover: !isOriginal ? false : params.isFailoverIteration,
        originalRequestId: !isOriginal ? params.logId : (params.isFailoverIteration ? params.rootLogId : null),
        routerKeyId: params.routerKeyId, originalModel: params.originalModel });
      lastSuccessLogId = attemptLogId;
    }
  }
  return lastSuccessLogId;
}

function collectMetrics(
  db: Database.Database,
  apiType: "openai" | "anthropic",
  result: ProxyResult | StreamProxyResult,
  isStream: boolean,
  lastSuccessLogId: string,
  providerId: string,
  backendModel: string,
  request: FastifyRequest,
) {
  const base = { request_log_id: lastSuccessLogId, provider_id: providerId, backend_model: backendModel, api_type: apiType };
  try {
    if (isStream) {
      const mr = (result as StreamProxyResult).metricsResult;
      if (mr) { insertMetrics(db, { ...base, ...mr }); return; }
    } else {
      const mr = MetricsExtractor.fromNonStreamResponse(apiType, (result as ProxyResult).body);
      if (mr) { insertMetrics(db, { ...base, ...mr }); return; }
    }
    // 无法提取完整 metrics（失败请求），至少记录 backend_model
    insertMetrics(db, base);
  } catch (err) { request.log.error({ err }, "Failed to insert metrics"); }
}

// ---------- Shared proxy handler ----------

const HTTP_BAD_GATEWAY = 502;
const HTTP_BAD_REQUEST = 400;

/**
 * 共享 POST handler，参数化 apiType/errorFormat/upstreamPath 等差异。
 * 当分组策略为 failover 时，在 while 循环中依次尝试不同 target，
 * 直到成功（或 headers 已发送）才返回。
 */
export async function handleProxyPost(
  request: FastifyRequest,
  reply: FastifyReply,
  apiType: "openai" | "anthropic",
  upstreamPath: string,
  errors: ProxyErrorFormatter,
  deps: ProxyHandlerDeps,
  options?: {
    beforeSendProxy?: (body: Record<string, unknown>, isStream: boolean) => void;
  },
): Promise<FastifyReply> {
  const { db, streamTimeoutMs, retryMaxAttempts, retryBaseDelayMs, matcher } = deps;

  request.raw.socket.on("error", (err) => request.log.debug({ err }, "client socket error"));
  const clientModel = ((request.body as Record<string, unknown>).model as string) || "unknown";

  // 代理增强：指令解析 + 模型替换 + 命令拦截
  const sessionId = (request.headers as RawHeaders)["x-claude-code-session-id"] as string | undefined;
  const { effectiveModel, originalModel, interceptResponse } = applyEnhancement(db, request, clientModel, sessionId);

  if (interceptResponse) return handleIntercept(db, apiType, request, reply, interceptResponse, clientModel);

  // 查询分组策略（只查一次）
  const group = getMappingGroup(db, effectiveModel);
  const isFailover = group?.strategy === "failover";
  const excludeTargets: Target[] = [];
  let rootLogId: string | null = null;

  while (true) {
    const startTime = Date.now();
    const logId = randomUUID();
    if (rootLogId === null) rootLogId = logId;
    const isFailoverIteration = rootLogId !== logId;
    const routerKeyId = request.routerKey?.id ?? null;
    const body = request.body as Record<string, unknown>;
    const originalBody = JSON.parse(JSON.stringify(body));
    const isStream = body.stream === true;
    const cliHdrs: RawHeaders = request.headers as RawHeaders;

    const resolved = resolveMapping(db, effectiveModel, { now: new Date(), excludeTargets });
    request.log.debug({ logId, model: effectiveModel, apiType, isStream, action: "resolve_mapping", resolved: !!resolved }, "Proxy: resolved model mapping");
    if (!resolved) {
      // failover 场景下所有 target 都已尝试失败，返回最后一个 target 的错误
      if (isFailover && excludeTargets.length > 0) {
        const e = errors.upstreamConnectionFailed();
        return reply.status(e.statusCode).send(e.body);
      }
      const e = errors.modelNotFound(effectiveModel);
      insertRejectedLog({ db, logId, apiType, model: effectiveModel, statusCode: e.statusCode,
        errorMessage: `No mapping found for model '${effectiveModel}'`, startTime, isStream,
        routerKeyId, originalBody, clientHeaders: cliHdrs, originalModel,
        isFailover: isFailoverIteration, originalRequestId: isFailoverIteration ? rootLogId : null });
      return reply.status(e.statusCode).send(e.body);
    }

    // 白名单校验
    if (excludeTargets.length === 0) {
      const allowedModels = request.routerKey?.allowed_models;
      if (allowedModels) {
        try {
          const models: string[] = JSON.parse(allowedModels).filter((m: string) => m.trim() !== "");
          if (models.length > 0 && !models.includes(resolved.backend_model)) {
            const e = errors.modelNotAllowed(resolved.backend_model);
            insertRejectedLog({ db, logId, apiType, model: effectiveModel, statusCode: e.statusCode,
              errorMessage: `Model '${resolved.backend_model}' not allowed for this API key`,
              startTime, isStream, routerKeyId, originalBody, clientHeaders: cliHdrs,
              providerId: resolved.provider_id, originalModel,
              isFailover: isFailoverIteration, originalRequestId: isFailoverIteration ? rootLogId : null });
            return reply.status(e.statusCode).send(e.body);
          }
        } catch { request.log.warn({ allowedModels: allowedModels?.slice(0, 80) }, "Invalid allowed_models JSON, allowing all models"); } // eslint-disable-line no-magic-numbers
      }
    }

    const provider = getProviderById(db, resolved.provider_id);
    if (!provider || !provider.is_active) {
      const e = errors.providerUnavailable();
      insertRejectedLog({ db, logId, apiType, model: effectiveModel, statusCode: e.statusCode,
        errorMessage: `Provider '${resolved.provider_id}' unavailable or inactive`,
        startTime, isStream, routerKeyId, originalBody, clientHeaders: cliHdrs,
        providerId: resolved.provider_id, originalModel,
        isFailover: isFailoverIteration, originalRequestId: isFailoverIteration ? rootLogId : null });
      return reply.status(e.statusCode).send(e.body);
    }
    if (provider.api_type !== apiType) {
      const e = errors.providerTypeMismatch();
      insertRejectedLog({ db, logId, apiType, model: effectiveModel, statusCode: e.statusCode,
        errorMessage: `Provider API type mismatch: expected '${apiType}', got '${provider.api_type}'`,
        startTime, isStream, routerKeyId, originalBody, clientHeaders: cliHdrs,
        providerId: resolved.provider_id, originalModel,
        isFailover: isFailoverIteration, originalRequestId: isFailoverIteration ? rootLogId : null });
      return reply.status(e.statusCode).send(e.body);
    }

    deps.tracker?.start({
      id: logId, apiType, model: effectiveModel, providerId: provider.id,
      providerName: provider.name, isStream, startTime, status: "pending",
      retryCount: 0, attempts: [], clientIp: request.ip,
    });
    request.log.debug({ logId, providerId: provider.id, providerName: provider.name, backendModel: resolved.backend_model, action: "request_started" }, "Proxy: request started in tracker");

    body.model = resolved.backend_model;
    const apiKey = decrypt(provider.api_key, getSetting(db, "encryption_key")!);

    options?.beforeSendProxy?.(body, isStream);

    const reqBodyStr = JSON.stringify(body);
    const clientReq = JSON.stringify({ headers: cliHdrs, body: originalBody });
    const retryConfig = buildRetryConfig(retryMaxAttempts, retryBaseDelayMs, matcher);
    const upstreamReqBase = JSON.stringify({ url: `${provider.base_url}${upstreamPath}`, headers: buildUpstreamHeaders(cliHdrs, apiKey, Buffer.byteLength(reqBodyStr)), body: reqBodyStr });

    // === Semaphore acquire ===
    const semaphoreManager = deps.semaphoreManager;
    let acquireToken: { generation: number } | undefined;
    let semaphoreReleased = false;
    const releaseSemaphore = () => {
      if (!semaphoreReleased) {
        semaphoreReleased = true;
        if (acquireToken) semaphoreManager?.release(provider.id, acquireToken, request.log);
      }
    };

    if (semaphoreManager) {
      const ac = new AbortController();
      request.raw.on("close", () => ac.abort());
      try {
        acquireToken = await semaphoreManager.acquire(provider.id, ac.signal, () => {
          deps.tracker?.update(logId, { queued: true });
        }, request.log);
        deps.tracker?.update(logId, { queued: false });
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          deps.tracker?.complete(logId, { status: "failed" });
          return reply;
        }
        if (err instanceof SemaphoreQueueFullError) {
          request.log.warn({ providerId: provider.id }, "Concurrency queue full, rejecting request");
          const e = errors.concurrencyQueueFull(provider.id);
          deps.tracker?.complete(logId, { status: "failed", statusCode: e.statusCode });
          return reply.status(e.statusCode).send(e.body);
        }
        if (err instanceof SemaphoreTimeoutError) {
          request.log.warn({ providerId: provider.id, timeoutMs: err.timeoutMs }, "Concurrency wait timed out");
          const e = errors.concurrencyTimeout(provider.id, err.timeoutMs);
          deps.tracker?.complete(logId, { status: "failed", statusCode: e.statusCode });
          return reply.status(e.statusCode).send(e.body);
        }
        throw err;
      }
    }

    try {
      request.log.debug({ logId, providerId: provider.id, isStream, upstreamUrl: `${provider.base_url}${upstreamPath}`, action: "upstream_call" }, "Proxy: calling upstream");
      const checkEarlyError = isStream && deps.matcher
        ? (data: string) => deps.matcher!.test(UPSTREAM_SUCCESS, data)
        : undefined;
      const { result: r, attempts } = isStream
        ? await retryableCall(
          () => {
            const metricsTransform = new SSEMetricsTransform(apiType, startTime, {
              onMetrics: (m) => {
                deps.tracker?.update(logId, {
                  streamMetrics: {
                    inputTokens: m.input_tokens,
                    outputTokens: m.output_tokens,
                    ttftMs: m.ttft_ms,
                    stopReason: m.stop_reason,
                    isComplete: m.is_complete === 1,
                  },
                });
              },
              onChunk: (rawLine) => {
                deps.tracker?.appendStreamChunk(logId, rawLine, apiType, STREAM_CONTENT_MAX_RAW, STREAM_CONTENT_MAX_TEXT);
              },
            });
            return upstreamStream(provider, apiKey, body, cliHdrs, reply, streamTimeoutMs, upstreamPath, buildUpstreamHeaders, metricsTransform, checkEarlyError);
          },
          retryConfig,
          reply,
        )
        : await retryableCall(
          () => upstreamNonStream(provider, apiKey, body, cliHdrs, upstreamPath, buildUpstreamHeaders),
          retryConfig,
          reply,
        );

      const trackerAttempts = attempts.map(a => ({
        statusCode: a.statusCode ?? null,
        error: a.error ?? null,
        latencyMs: a.latencyMs,
        providerId: provider.id,
      }));
      deps.tracker?.update(logId, {
        retryCount: Math.max(0, attempts.length - 1),
        attempts: trackerAttempts,
        providerId: provider.id,
      });
      request.log.debug({ logId, statusCode: r.statusCode, attemptCount: attempts.length, latencyMs: Date.now() - startTime, action: "upstream_response" }, "Proxy: upstream responded");

      const lastSuccessLogId = logRetryAttempts(db, {
        apiType, model: effectiveModel, providerId: provider.id, isStream,
        reqBodyStr, clientReq, upstreamReqBase, logId, routerKeyId, originalModel,
        isFailoverIteration, rootLogId: rootLogId!,
      }, attempts, r, startTime);

      // --- Failover 检查 ---
      if (isFailover && r.statusCode >= FAILOVER_FAIL_THRESHOLD && !reply.raw.headersSent) {
        request.log.debug({ logId, statusCode: r.statusCode, excludedTargets: excludeTargets.length, action: "failover" }, "Proxy: failover triggered, trying next target");
        deps.tracker?.complete(logId, { status: "failed", statusCode: r.statusCode });
        releaseSemaphore();
        excludeTargets.push(resolved);
        continue;
      }

      // 发送响应
      if (isStream) {
        if (r.statusCode !== UPSTREAM_SUCCESS) {
          for (const [k, v] of Object.entries((r as StreamProxyResult).upstreamResponseHeaders ?? {})) reply.header(k, v);
          reply.status(r.statusCode).send((r as StreamProxyResult).responseBody);
        }
      } else {
        const pr = r as ProxyResult;
        // 非流式响应：模型替换时注入 router-response 标签
        if (originalModel && pr.statusCode === UPSTREAM_SUCCESS) {
          try {
            const bodyObj = JSON.parse(pr.body as string);
            if (bodyObj.content?.[0]?.text) {
              bodyObj.content[0].text += `\n\n${buildModelInfoTag(effectiveModel)}`;
              pr.body = JSON.stringify(bodyObj);
            }
          } catch { request.log.debug("Failed to inject model-info tag into non-JSON response"); }
        }
        for (const [k, v] of Object.entries(pr.headers)) reply.header(k, v);
        reply.status(pr.statusCode).send(pr.body);
      }

      collectMetrics(db, apiType, r, isStream, lastSuccessLogId, provider.id, resolved.backend_model, request);
      deps.tracker?.complete(logId, { status: r.statusCode < HTTP_BAD_REQUEST ? "completed" : "failed", statusCode: r.statusCode });
      request.log.debug({ logId, statusCode: r.statusCode, status: r.statusCode < HTTP_BAD_REQUEST ? "completed" : "failed", totalLatencyMs: Date.now() - startTime, action: "request_completed" }, "Proxy: request completed");
      releaseSemaphore();
      return reply;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      request.log.debug({ logId, error: errMsg, action: "upstream_error" }, "Proxy: upstream call threw error");
      const sentH = buildUpstreamHeaders(cliHdrs, apiKey, Buffer.byteLength(reqBodyStr));
      const upstreamReq = JSON.stringify({ url: `${provider.base_url}${upstreamPath}`, headers: sentH, body: reqBodyStr });
      insertRequestLog(db, {
        id: logId, api_type: apiType, model: effectiveModel, provider_id: provider.id,
        status_code: HTTP_BAD_GATEWAY, latency_ms: Date.now() - startTime,
        is_stream: isStream ? 1 : 0, error_message: errMsg || "Upstream connection failed",
        created_at: new Date().toISOString(), request_body: reqBodyStr,
        client_request: clientReq, upstream_request: upstreamReq,
        is_failover: isFailoverIteration ? 1 : 0,
        original_request_id: isFailoverIteration ? rootLogId : null,
        router_key_id: routerKeyId, original_model: originalModel,
      });

      // --- Failover 检查（异常路径）---
      if (isFailover && !reply.raw.headersSent) {
        request.log.debug({ logId, error: errMsg, excludedTargets: excludeTargets.length, action: "failover_error" }, "Proxy: failover on error, trying next target");
        deps.tracker?.complete(logId, { status: "failed" });
        releaseSemaphore();
        excludeTargets.push(resolved);
        continue;
      }

      const e = errors.upstreamConnectionFailed();
      deps.tracker?.complete(logId, { status: "failed", statusCode: HTTP_BAD_GATEWAY });
      request.log.debug({ logId, statusCode: HTTP_BAD_GATEWAY, error: errMsg, action: "request_failed" }, "Proxy: request failed");
      releaseSemaphore();
      return reply.status(e.statusCode).send(e.body);
    }
  }
}

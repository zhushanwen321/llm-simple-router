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
import { retryableCall, buildRetryConfig } from "./retry.js";
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
}

export interface ProxyHandlerDeps {
  db: Database.Database;
  streamTimeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  matcher?: RetryRuleMatcher;
}

// Re-export upstream types for external consumers
export type { ProxyResult, StreamProxyResult, GetProxyResult };

// ---------- Constants ----------

const UPSTREAM_SUCCESS = 200;
const FAILOVER_FAIL_THRESHOLD = 400;

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

// ---------- Shared proxy handler ----------

const HTTP_BAD_GATEWAY = 502;

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

  // 命令拦截（如 select-model）：直接返回，不转发上游
  if (interceptResponse) {
    const logId = randomUUID();
    const isStream = (request.body as Record<string, unknown>).stream === true;
    const interceptRespBody = JSON.stringify(interceptResponse.body);
    insertRequestLog(db, {
      id: logId, api_type: apiType, model: clientModel, provider_id: "router",
      status_code: interceptResponse.statusCode, latency_ms: 0,
      is_stream: isStream ? 1 : 0, error_message: null,
      created_at: new Date().toISOString(),
      request_body: JSON.stringify(request.body),
      response_body: interceptRespBody,
      client_request: JSON.stringify({ headers: request.headers as RawHeaders, body: request.body }),
      upstream_request: interceptResponse.meta ? JSON.stringify(interceptResponse.meta) : null,
      client_response: JSON.stringify({ statusCode: interceptResponse.statusCode, body: interceptRespBody }),
      is_retry: 0, original_request_id: null,
      router_key_id: request.routerKey?.id ?? null, original_model: null,
    });
    return reply.status(interceptResponse.statusCode).send(interceptResponse.body);
  }

  // 查询分组策略（只查一次）
  const group = getMappingGroup(db, effectiveModel);
  const isFailover = group?.strategy === "failover";
  const excludeTargets: Target[] = [];

  while (true) {
    const startTime = Date.now();
    const logId = randomUUID();
    const routerKeyId = request.routerKey?.id ?? null;
    const body = request.body as Record<string, unknown>;
    const originalBody = JSON.parse(JSON.stringify(body));
    const isStream = body.stream === true;
    const cliHdrs: RawHeaders = request.headers as RawHeaders;

    const resolved = resolveMapping(db, effectiveModel, { now: new Date(), excludeTargets });
    if (!resolved) {
      if (isFailover && excludeTargets.length > 0) {
        return reply;
      }
      const e = errors.modelNotFound(effectiveModel);
      insertRejectedLog({ db, logId, apiType, model: effectiveModel, statusCode: e.statusCode,
        errorMessage: `No mapping found for model '${effectiveModel}'`, startTime, isStream,
        routerKeyId, originalBody, clientHeaders: cliHdrs, originalModel });
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
              providerId: resolved.provider_id, originalModel });
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
        providerId: resolved.provider_id, originalModel });
      return reply.status(e.statusCode).send(e.body);
    }
    if (provider.api_type !== apiType) {
      const e = errors.providerTypeMismatch();
      insertRejectedLog({ db, logId, apiType, model: effectiveModel, statusCode: e.statusCode,
        errorMessage: `Provider API type mismatch: expected '${apiType}', got '${provider.api_type}'`,
        startTime, isStream, routerKeyId, originalBody, clientHeaders: cliHdrs,
        providerId: resolved.provider_id, originalModel });
      return reply.status(e.statusCode).send(e.body);
    }

    body.model = resolved.backend_model;
    const apiKey = decrypt(provider.api_key, getSetting(db, "encryption_key")!);

    options?.beforeSendProxy?.(body, isStream);

    const reqBodyStr = JSON.stringify(body);
    const clientReq = JSON.stringify({ headers: cliHdrs, body: originalBody });
    const retryConfig = buildRetryConfig(retryMaxAttempts, retryBaseDelayMs, matcher);
    const upstreamReqBase = JSON.stringify({ url: `${provider.base_url}${upstreamPath}`, headers: buildUpstreamHeaders(cliHdrs, apiKey, Buffer.byteLength(reqBodyStr)), body: reqBodyStr });

    try {
      const { result: r, attempts } = isStream
        ? await retryableCall(
            () => {
              const metricsTransform = new SSEMetricsTransform(apiType, startTime);
              return upstreamStream(provider, apiKey, body, cliHdrs, reply, streamTimeoutMs, upstreamPath, buildUpstreamHeaders, metricsTransform);
            },
            retryConfig,
            reply,
          )
        : await retryableCall(
            () => upstreamNonStream(provider, apiKey, body, cliHdrs, upstreamPath, buildUpstreamHeaders),
            retryConfig,
            reply,
          );

      // 记录所有尝试的日志
      let lastSuccessLogId = logId;
      for (const attempt of attempts) {
        const isOriginal = attempt.attemptIndex === 0;
        const attemptLogId = isOriginal ? logId : randomUUID();

        if (attempt.error) {
          insertRequestLog(db, {
            id: attemptLogId, api_type: apiType, model: effectiveModel, provider_id: provider.id,
            status_code: HTTP_BAD_GATEWAY, latency_ms: attempt.latencyMs,
            is_stream: isStream ? 1 : 0, error_message: attempt.error,
            created_at: new Date().toISOString(), request_body: reqBodyStr,
            client_request: clientReq, upstream_request: upstreamReqBase,
            is_retry: isOriginal ? 0 : 1, original_request_id: isOriginal ? null : logId,
            router_key_id: routerKeyId, original_model: originalModel,
          });
        } else if (attempt.statusCode !== UPSTREAM_SUCCESS) {
          insertRequestLog(db, {
            id: attemptLogId, api_type: apiType, model: effectiveModel, provider_id: provider.id,
            status_code: attempt.statusCode, latency_ms: attempt.latencyMs,
            is_stream: isStream ? 1 : 0, error_message: null,
            created_at: new Date().toISOString(), request_body: reqBodyStr,
            response_body: attempt.responseBody, client_request: clientReq, upstream_request: upstreamReqBase,
            upstream_response: JSON.stringify({ statusCode: attempt.statusCode, body: attempt.responseBody }),
            client_response: JSON.stringify({ statusCode: attempt.statusCode, body: attempt.responseBody }),
            is_retry: isOriginal ? 0 : 1, original_request_id: isOriginal ? null : logId,
            router_key_id: routerKeyId, original_model: originalModel,
          });
        } else {
          const h = isStream
            ? ((r as StreamProxyResult).upstreamResponseHeaders ?? {})
            : ((r as ProxyResult).headers);
          insertSuccessLog(db, { apiType, model: effectiveModel, provider, isStream, startTime,
            reqBody: reqBodyStr, clientReq, upstreamReq: upstreamReqBase, id: attemptLogId,
            status: r.statusCode, respBody: attempt.responseBody, upHdrs: h, cliHdrs: h,
            isRetry: !isOriginal, originalRequestId: isOriginal ? null : logId,
            routerKeyId, originalModel });
          lastSuccessLogId = attemptLogId;
        }
      }

      // --- Failover 检查 ---
      if (isFailover && r.statusCode >= FAILOVER_FAIL_THRESHOLD && !reply.raw.headersSent) {
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
        return reply.status(pr.statusCode).send(pr.body);
      }

      // metrics 采集
      if (r.statusCode === UPSTREAM_SUCCESS) {
        if (isStream) {
          const streamResult = r as StreamProxyResult;
          if (streamResult.metricsResult) {
            try { insertMetrics(db, { ...streamResult.metricsResult, request_log_id: lastSuccessLogId, provider_id: provider.id, backend_model: resolved.backend_model, api_type: apiType }); }
            catch (err) { request.log.error({ err }, "Failed to insert metrics"); }
          }
        } else {
          try {
            const mr = MetricsExtractor.fromNonStreamResponse(apiType, (r as ProxyResult).body);
            if (mr) insertMetrics(db, { ...mr, request_log_id: lastSuccessLogId, provider_id: provider.id, backend_model: resolved.backend_model, api_type: apiType });
          } catch (err) { request.log.error({ err }, "Failed to insert metrics"); }
        }
      }
      return reply;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const sentH = buildUpstreamHeaders(cliHdrs, apiKey, Buffer.byteLength(reqBodyStr));
      const upstreamReq = JSON.stringify({ url: `${provider.base_url}${upstreamPath}`, headers: sentH, body: reqBodyStr });
      insertRequestLog(db, {
        id: logId, api_type: apiType, model: effectiveModel, provider_id: provider.id,
        status_code: HTTP_BAD_GATEWAY, latency_ms: Date.now() - startTime,
        is_stream: isStream ? 1 : 0, error_message: errMsg || "Upstream connection failed",
        created_at: new Date().toISOString(), request_body: reqBodyStr,
        client_request: clientReq, upstream_request: upstreamReq,
        router_key_id: routerKeyId, original_model: originalModel,
      });

      // --- Failover 检查（异常路径）---
      if (isFailover && !reply.raw.headersSent) {
        excludeTargets.push(resolved);
        continue;
      }

      const e = errors.upstreamConnectionFailed();
      return reply.status(e.statusCode).send(e.body);
    }
  }
}

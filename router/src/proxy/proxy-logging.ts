import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import type { Provider } from "../db/index.js";
import { insertRequestLog, insertMetrics } from "../db/index.js";
import type { LogWriteContext } from "../db/logs.js";
import type { LogFileWriter } from "../storage/log-file-writer.js";
import { insertSuccessLog, type FailoverContext } from "./log-helpers.js";
import { MetricsExtractor } from "../metrics/metrics-extractor.js";
import { estimateInputTokens } from "../utils/token-counter.js";
import type { FastifyRequest } from "fastify";
import type { ResilienceAttempt } from "../core/types.js";
import type { TransportResult } from "./types.js";

// Internal imports from types.ts
import { UPSTREAM_SUCCESS } from "./types.js";
import { HTTP_BAD_GATEWAY } from "../core/constants.js";

// ---------- Header sanitization ----------

const SENSITIVE_HEADER_RE = /^(authorization|x-api-key)$/i;

/** 日志存储前脱敏 Authorization / x-api-key header，避免 API Key 被持久化 */
export function sanitizeHeadersForLog(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    sanitized[key] = SENSITIVE_HEADER_RE.test(key) ? value.replace(/(Bearer\s+)\S+/, "$1sk-***") : value;
  }
  return sanitized;
}

// ---------- Logging helpers (extracted from proxy-core) ----------

// ---------- New-architecture logging ----------

export function logResilienceResult(
  db: Database.Database,
  params: {
    apiType: "openai" | "openai-responses" | "anthropic";
    model: string;
    providerId: string;
    isStream: boolean;
    clientReq: string;
    upstreamReqBase: string;
    logId: string;
    routerKeyId: string | null;
    originalModel: string | null;
    sessionId?: string | null;
    pipelineSnapshot?: string;
    failover?: FailoverContext;
    matcher?: { test: (statusCode: number, body: string) => boolean } | null;
    logFileWriter?: LogFileWriter | null;
  },
  attempts: ResilienceAttempt[],
  result: TransportResult,
  startTime: number,
): string {
  const isFailoverIteration = params.failover?.isFailoverIteration ?? false;
  const rootLogId = params.failover?.rootLogId ?? params.logId;
  let lastSuccessLogId = params.logId;

  for (const attempt of attempts) {
    const isOriginal = attempt.attemptIndex === 0;
    const attemptLogId = isOriginal ? params.logId : randomUUID();
    const isFailoverLog = isOriginal && isFailoverIteration;
    const parentId = isOriginal ? (isFailoverIteration ? rootLogId : null) : params.logId;

    // 构建 writeContext（所有路径共享，error/stream_error 路径 status >= 400 所以 preserveDetail=true，但文件写入仍需执行）
    const attemptWriteContext: LogWriteContext | undefined = (params.matcher || params.logFileWriter) ? {
      matcher: params.matcher,
      logFileWriter: params.logFileWriter,
      responseBody: attempt.responseBody,
    } : undefined;

    // stream_error + statusCode 200: 上游返回 200 但 body 包含错误内容（如 early error detection）
    // 非 200 的 stream_error（如上游 429/500）走下方的正常错误路径
    if (attempt.resultKind === "stream_error" && attempt.statusCode === UPSTREAM_SUCCESS) {
      insertRequestLog(db, {
        id: attemptLogId, api_type: params.apiType, model: params.model,
        provider_id: attempt.target.provider_id,
        status_code: HTTP_BAD_GATEWAY, latency_ms: attempt.latencyMs,
        is_stream: params.isStream ? 1 : 0,
        error_message: "stream_error: upstream returned 200 but body contains error",
        created_at: new Date().toISOString(),
        client_request: params.clientReq, upstream_request: params.upstreamReqBase,
        upstream_response: JSON.stringify({ statusCode: attempt.statusCode, headers: attempt.responseHeaders, body: attempt.responseBody }),
        is_retry: isOriginal ? 0 : 1, is_failover: isFailoverLog ? 1 : 0,
        original_request_id: parentId,
        router_key_id: params.routerKeyId, original_model: params.originalModel,
        session_id: params.sessionId,
        pipeline_snapshot: params.pipelineSnapshot ?? null,
      }, attemptWriteContext);
    } else if (attempt.error) {
      insertRequestLog(db, {
        id: attemptLogId, api_type: params.apiType, model: params.model,
        provider_id: attempt.target.provider_id,
        status_code: HTTP_BAD_GATEWAY, latency_ms: attempt.latencyMs,
        is_stream: params.isStream ? 1 : 0, error_message: attempt.error,
        created_at: new Date().toISOString(),
        client_request: params.clientReq, upstream_request: params.upstreamReqBase,
        upstream_response: attempt.responseHeaders
          ? JSON.stringify({ statusCode: HTTP_BAD_GATEWAY, headers: attempt.responseHeaders, error: attempt.error })
          : null,
        is_retry: isOriginal ? 0 : 1, is_failover: isFailoverLog ? 1 : 0,
        original_request_id: parentId,
        router_key_id: params.routerKeyId, original_model: params.originalModel,
        session_id: params.sessionId,
        pipeline_snapshot: params.pipelineSnapshot ?? null,
      }, attemptWriteContext);
    } else if (attempt.statusCode !== UPSTREAM_SUCCESS) {
      insertRequestLog(db, {
        id: attemptLogId, api_type: params.apiType, model: params.model,
        provider_id: attempt.target.provider_id,
        status_code: attempt.statusCode!, latency_ms: attempt.latencyMs,
        is_stream: params.isStream ? 1 : 0, error_message: null,
        created_at: new Date().toISOString(),
        client_request: params.clientReq, upstream_request: params.upstreamReqBase,
        upstream_response: JSON.stringify({ statusCode: attempt.statusCode, headers: attempt.responseHeaders, body: attempt.responseBody }),
        is_retry: isOriginal ? 0 : 1, is_failover: isFailoverLog ? 1 : 0,
        original_request_id: parentId,
        router_key_id: params.routerKeyId, original_model: params.originalModel,
        session_id: params.sessionId,
        pipeline_snapshot: params.pipelineSnapshot ?? null,
      }, attemptWriteContext);
    } else {
      const upHdrs = (result.kind === "stream_success" || result.kind === "stream_abort")
        ? (result.upstreamResponseHeaders ?? {})
        : ("headers" in result ? result.headers : {});
      insertSuccessLog(db, {
        apiType: params.apiType, model: params.model,
        provider: { id: attempt.target.provider_id } as Provider,
        isStream: params.isStream, startTime,
        clientReq: params.clientReq,
        upstreamReq: params.upstreamReqBase, id: attemptLogId,
        status: attempt.statusCode!, respBody: attempt.responseBody,
        upHdrs,
        isRetry: !isOriginal, isFailover: isFailoverLog,
        originalRequestId: parentId,
        routerKeyId: params.routerKeyId, originalModel: params.originalModel,
        sessionId: params.sessionId,
        pipelineSnapshot: params.pipelineSnapshot,
        matcher: params.matcher,
        logFileWriter: params.logFileWriter,
      });
      lastSuccessLogId = attemptLogId;
    }
  }
  return lastSuccessLogId;
}

export function collectTransportMetrics(
  db: Database.Database,
  apiType: "openai" | "openai-responses" | "anthropic",
  result: TransportResult,
  isStream: boolean,
  lastSuccessLogId: string,
  providerId: string,
  backendModel: string,
  request: FastifyRequest,
  routerKeyId?: string | null,
  statusCode?: number | null,
) {
  const base = {
    request_log_id: lastSuccessLogId, provider_id: providerId, backend_model: backendModel, api_type: apiType,
    router_key_id: routerKeyId ?? null, status_code: statusCode ?? null,
  };
  try {
    if (isStream && (result.kind === "stream_success" || result.kind === "stream_abort")) {
      if (result.metrics) {
        const metrics = { ...result.metrics };
        if (!metrics.input_tokens && request.body) {
          metrics.input_tokens = estimateInputTokens(request.body as Record<string, unknown>);
          metrics.input_tokens_estimated = 1;
        }
        insertMetrics(db, { ...base, ...metrics });
        return;
      }
    } else if (result.kind === "success") {
      const mr = MetricsExtractor.fromNonStreamResponse(apiType, result.body);
      if (mr) {
        if (!mr.input_tokens && request.body) {
          mr.input_tokens = estimateInputTokens(request.body as Record<string, unknown>);
          mr.input_tokens_estimated = 1;
        }
        insertMetrics(db, { ...base, ...mr });
        return;
      }
    }
    // 无法提取完整 metrics 的 fallback，标记为未完成
    insertMetrics(db, { ...base, is_complete: 0 });
  } catch (err) { request.log.error({ err }, "Failed to insert metrics"); }
}

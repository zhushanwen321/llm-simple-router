import Database from "better-sqlite3";
import type { Provider } from "../db/index.js";
import { insertRequestLog } from "../db/index.js";
import type { LogWriteContext } from "../db/logs.js";
import type { LogFileWriter } from "../storage/log-file-writer.js";
import type { RetryMatcher } from "./log-detail-policy.js";
import type { RawHeaders } from "./types.js";

export interface FailoverContext {
  isFailoverIteration: boolean;
  rootLogId: string;
}

export interface LogRetryMeta {
  isRetry?: boolean;
  isFailover?: boolean;
  originalRequestId?: string | null;
}

export interface RequestLogParams extends LogRetryMeta {
  id: string;
  apiType: string;
  model: string;
  provider: Provider;
  isStream: boolean;
  startTime: number;
  clientReq: string;
  upstreamReq: string;
  status: number;
  respBody: string | null;
  upHdrs: Record<string, string>;
  routerKeyId?: string | null;
  originalModel?: string | null;
  sessionId?: string | null;
  pipelineSnapshot?: string | null;
  matcher?: RetryMatcher | null;
  logFileWriter?: LogFileWriter | null;
  transport_kind?: string | null;
  abort_reason?: string | null;
  error_code?: string | null;
  headers_sent?: number | null;
  resilience_action?: string | null;
  resilience_reason?: string | null;
  mapping_reason?: string | null;
  failover_trigger?: string | null;
  upstream_api_type?: string | null;
  upstream_base_url?: string | null;
  backend_model?: string | null;
}

/** 插入成功请求日志，供 openai/anthropic 插件共享 */
export function insertSuccessLog(
  db: Database.Database,
  params: RequestLogParams,
): void {
  const { id: logId, apiType, model, provider, isStream, startTime,
    clientReq, upstreamReq, status, respBody, upHdrs,
    isRetry = false, isFailover = false, originalRequestId = null, routerKeyId = null, originalModel = null,
    sessionId = null, pipelineSnapshot = null, matcher, logFileWriter,
    transport_kind, abort_reason, error_code, headers_sent, resilience_action, resilience_reason, mapping_reason, failover_trigger,
    upstream_api_type, upstream_base_url, backend_model } = params;

  const writeContext: LogWriteContext | undefined = (matcher || logFileWriter) ? {
    matcher,
    logFileWriter,
    responseBody: respBody,
  } : undefined;

  insertRequestLog(db, {
    id: logId, api_type: apiType, model, provider_id: provider.id,
    status_code: status, latency_ms: Date.now() - startTime,
    is_stream: isStream ? 1 : 0, error_message: null,
    created_at: new Date().toISOString(),
    client_request: clientReq, upstream_request: upstreamReq,
    upstream_response: JSON.stringify({ statusCode: status, headers: upHdrs, body: respBody }),
    is_retry: isRetry ? 1 : 0, is_failover: isFailover ? 1 : 0, original_request_id: originalRequestId,
    router_key_id: routerKeyId, original_model: originalModel,
    session_id: sessionId,
    pipeline_snapshot: pipelineSnapshot ?? null,
    transport_kind: transport_kind ?? null,
    abort_reason: abort_reason ?? null,
    error_code: error_code ?? null,
    headers_sent: headers_sent ?? null,
    resilience_action: resilience_action ?? null,
    resilience_reason: resilience_reason ?? null,
    mapping_reason: mapping_reason ?? null,
    failover_trigger: failover_trigger ?? null,
    upstream_api_type: upstream_api_type ?? null,
    upstream_base_url: upstream_base_url ?? null,
    backend_model: backend_model ?? null,
  }, writeContext);
}

export interface RejectedLogParams extends LogRetryMeta {
  db: Database.Database;
  logId: string;
  apiType: string;
  model: string;
  statusCode: number;
  errorMessage: string;
  startTime: number;
  isStream: boolean;
  routerKeyId: string | null;
  originalBody: Record<string, unknown>;
  clientHeaders: RawHeaders;
  providerId?: string | null;
  originalModel?: string | null;
  sessionId?: string | null;
  pipelineSnapshot?: string | null;
  matcher?: RetryMatcher | null;
  logFileWriter?: LogFileWriter | null;
  mapping_reason?: string | null;
  transport_kind?: string | null;
  abort_reason?: string | null;
  error_code?: string | null;
  headers_sent?: number | null;
  resilience_action?: string | null;
  resilience_reason?: string | null;
  failover_trigger?: string | null;
  upstream_api_type?: string | null;
  upstream_base_url?: string | null;
  backend_model?: string | null;
}

/** Log a request rejected before reaching upstream */
export function insertRejectedLog(params: RejectedLogParams): void {
  const { db, logId, apiType, model, statusCode, errorMessage,
    startTime, isStream, routerKeyId, originalBody, clientHeaders,
    providerId = null, isFailover = false, originalRequestId = null, originalModel = null,
    sessionId = null, pipelineSnapshot = null, matcher, logFileWriter,
    mapping_reason, transport_kind, abort_reason, error_code, headers_sent,
    resilience_action, resilience_reason, failover_trigger,
    upstream_api_type, upstream_base_url, backend_model } = params;

  const writeContext: LogWriteContext | undefined = (matcher || logFileWriter) ? {
    matcher,
    logFileWriter,
    responseBody: null,
  } : undefined;

  insertRequestLog(db, {
    id: logId,
    api_type: apiType,
    model,
    provider_id: providerId,
    status_code: statusCode,
    latency_ms: Date.now() - startTime,
    is_stream: isStream ? 1 : 0,
    error_message: errorMessage,
    created_at: new Date().toISOString(),
    client_request: JSON.stringify({ headers: clientHeaders, body: originalBody }),
    is_failover: isFailover ? 1 : 0,
    original_request_id: originalRequestId,
    router_key_id: routerKeyId,
    original_model: originalModel,
    session_id: sessionId,
    pipeline_snapshot: pipelineSnapshot ?? null,
    transport_kind: transport_kind ?? null,
    abort_reason: abort_reason ?? null,
    error_code: error_code ?? null,
    headers_sent: headers_sent ?? null,
    resilience_action: resilience_action ?? null,
    resilience_reason: resilience_reason ?? null,
    mapping_reason: mapping_reason ?? null,
    failover_trigger: failover_trigger ?? null,
    upstream_api_type: upstream_api_type ?? null,
    upstream_base_url: upstream_base_url ?? null,
    backend_model: backend_model ?? null,
  }, writeContext);
}

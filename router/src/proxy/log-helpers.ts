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
}

/** 插入成功请求日志，供 openai/anthropic 插件共享 */
export function insertSuccessLog(
  db: Database.Database,
  params: RequestLogParams,
): void {
  const { id: logId, apiType, model, provider, isStream, startTime,
    clientReq, upstreamReq, status, respBody, upHdrs,
    isRetry = false, isFailover = false, originalRequestId = null, routerKeyId = null, originalModel = null,
    sessionId = null, pipelineSnapshot = null, matcher, logFileWriter } = params;

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
}

/** Log a request rejected before reaching upstream */
export function insertRejectedLog(params: RejectedLogParams): void {
  const { db, logId, apiType, model, statusCode, errorMessage,
    startTime, isStream, routerKeyId, originalBody, clientHeaders,
    providerId = null, isFailover = false, originalRequestId = null, originalModel = null,
    sessionId = null, pipelineSnapshot = null, matcher, logFileWriter } = params;

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
  }, writeContext);
}

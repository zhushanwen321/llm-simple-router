import Database from "better-sqlite3";
import type { Provider } from "../db/index.js";
import { insertRequestLog } from "../db/index.js";
import type { RawHeaders } from "./proxy-core.js";

export interface RequestLogParams {
  id: string;
  apiType: string;
  model: string;
  provider: Provider;
  isStream: boolean;
  startTime: number;
  reqBody: string;
  clientReq: string;
  upstreamReq: string;
  status: number;
  respBody: string | null;
  upHdrs: Record<string, string>;
  cliHdrs: Record<string, string>;
  isRetry?: boolean;
  originalRequestId?: string | null;
  routerKeyId?: string | null;
  originalModel?: string | null;
}

/** 插入成功请求日志，供 openai/anthropic 插件共享 */
export function insertSuccessLog(
  db: Database.Database,
  params: RequestLogParams,
): void {
  const { id: logId, apiType, model, provider, isStream, startTime,
    reqBody, clientReq, upstreamReq, status, respBody, upHdrs, cliHdrs,
    isRetry = false, originalRequestId = null, routerKeyId = null, originalModel = null } = params;

  insertRequestLog(db, {
    id: logId, api_type: apiType, model, provider_id: provider.id,
    status_code: status, latency_ms: Date.now() - startTime,
    is_stream: isStream ? 1 : 0, error_message: null,
    created_at: new Date().toISOString(), request_body: reqBody,
    response_body: respBody, client_request: clientReq, upstream_request: upstreamReq,
    upstream_response: JSON.stringify({ statusCode: status, headers: upHdrs, body: respBody }),
    client_response: JSON.stringify({ statusCode: status, headers: cliHdrs, body: respBody }),
    is_retry: isRetry ? 1 : 0, original_request_id: originalRequestId,
    router_key_id: routerKeyId, original_model: originalModel,
  });
}

export interface RejectedLogParams {
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
}

/** Log a request rejected before reaching upstream */
export function insertRejectedLog(params: RejectedLogParams): void {
  const { db, logId, apiType, model, statusCode, errorMessage,
    startTime, isStream, routerKeyId, originalBody, clientHeaders,
    providerId = null, originalModel = null } = params;

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
    request_body: JSON.stringify(originalBody),
    client_request: JSON.stringify({ headers: clientHeaders, body: originalBody }),
    router_key_id: routerKeyId,
    original_model: originalModel,
  });
}

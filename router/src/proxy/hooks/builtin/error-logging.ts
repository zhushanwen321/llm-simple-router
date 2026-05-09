/**
 * on_error hook: 错误日志记录。
 *
 * 在请求失败时执行，记录 rejected/error 日志并 flush pending tool errors。
 *
 * 依赖：ctx.metadata 中需设置 "db"、"startTime"、"matcher"、"logFileWriter"、
 *       "pendingToolErrors"。
 *       错误信息通过 ctx.metadata 设置：
 *       - "errorInfo": { statusCode, errorMessage, providerId? }
 *       - "pipelineSnapshot": string (可选，默认使用 ctx.snapshot.toJSON())
 */
import Database from "better-sqlite3";
import { insertRequestLog } from "../../../db/index.js";
import { insertRejectedLog } from "../../log-helpers.js";
import { logToolErrors } from "../../tool-error-logger.js";
import { detectClientAgentType } from "../../handler/proxy-handler-utils.js";
import type { FailedToolResult } from "../../handler/proxy-handler-utils.js";
import type { PipelineHook, PipelineContext } from "../../pipeline/types.js";
import type { RetryMatcher } from "../../log-detail-policy.js";
import type { LogFileWriter } from "../../../storage/log-file-writer.js";

const UPSTREAM_ERROR_STATUS = 502;

interface ErrorInfo {
  statusCode: number;
  errorMessage: string;
  providerId?: string;
  isRejected?: boolean;
}

export const errorLoggingHook: PipelineHook = {
  name: "builtin:error-logging",
  phase: "on_error",
  priority: 900,
  execute(ctx: PipelineContext): void {
    const db = ctx.metadata.get("db") as Database.Database;
    const startTime = ctx.metadata.get("startTime") as number;
    const matcher = ctx.metadata.get("matcher") as { test: (statusCode: number, body: string) => boolean } | null;
    const logFileWriter = ctx.metadata.get("logFileWriter") as unknown;
    const errorInfo = ctx.metadata.get("errorInfo") as ErrorInfo | undefined;

    if (!db || !startTime) return;

    const routerKeyId = (ctx.request.routerKey as { id?: string } | undefined)?.id ?? null;
    const isFailoverIteration = ctx.rootLogId !== null && ctx.rootLogId !== ctx.logId;
    const apiType = ctx.apiType as "openai" | "openai-responses" | "anthropic";
    const snapshot = (ctx.metadata.get("pipelineSnapshot") as string) ?? ctx.snapshot.toJSON();

    if (errorInfo?.isRejected) {
      // rejected 路径：使用 insertRejectedLog
      insertRejectedLog({
        db,
        logId: ctx.logId,
        apiType,
        model: ctx.clientModel,
        statusCode: errorInfo.statusCode,
        errorMessage: errorInfo.errorMessage,
        startTime,
        isStream: ctx.isStream,
        routerKeyId,
        originalBody: ctx.rawBody,
        clientHeaders: ctx.request.headers as Record<string, string>,
        providerId: errorInfo.providerId ?? null,
        isFailover: isFailoverIteration,
        originalRequestId: isFailoverIteration ? ctx.rootLogId : null,
        sessionId: ctx.sessionId,
        pipelineSnapshot: snapshot,
        matcher: matcher as RetryMatcher | null,
        logFileWriter: logFileWriter as LogFileWriter | null,
      });
    } else {
      // upstream error 路径：使用 insertRequestLog
      insertRequestLog(db, {
        id: ctx.logId,
        api_type: apiType,
        model: ctx.clientModel,
        provider_id: errorInfo?.providerId ?? ctx.provider?.id ?? null,
        status_code: errorInfo?.statusCode ?? UPSTREAM_ERROR_STATUS,
        latency_ms: Date.now() - startTime,
        is_stream: ctx.isStream ? 1 : 0,
        error_message: errorInfo?.errorMessage || "Upstream connection failed",
        created_at: new Date().toISOString(),
        client_request: ctx.clientRequest,
        upstream_request: ctx.upstreamRequest,
        is_failover: isFailoverIteration ? 1 : 0,
        original_request_id: isFailoverIteration ? ctx.rootLogId : null,
        router_key_id: routerKeyId,
        original_model: null,
        session_id: ctx.sessionId,
        pipeline_snapshot: snapshot,
      }, (matcher || logFileWriter) ? {
        matcher,
        logFileWriter: logFileWriter as LogFileWriter | null,
        responseBody: null,
      } : undefined);
    }

    // flush pending tool errors
    const pendingToolErrors = ctx.metadata.get("pendingToolErrors") as FailedToolResult[] | undefined;
    if (pendingToolErrors && (errorInfo?.providerId ?? ctx.provider?.id)) {
      logToolErrors(pendingToolErrors, {
        db,
        providerId: errorInfo?.providerId ?? ctx.provider!.id,
        backendModel: ctx.resolved?.backend_model ?? ctx.clientModel,
        clientAgentType: detectClientAgentType(ctx.request.headers as Record<string, string>),
        requestLogId: ctx.logId,
        routerKeyId,
        sessionId: ctx.sessionId,
      });
      ctx.metadata.delete("pendingToolErrors");
    }
  },
};

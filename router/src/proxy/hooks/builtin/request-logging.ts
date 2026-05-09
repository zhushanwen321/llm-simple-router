/**
 * post_response hook: 成功请求的日志记录和指标采集。
 *
 * 在请求成功完成后执行：
 * 1. logResilienceResult — 记录所有重试/failover 尝试日志
 * 2. collectTransportMetrics — 采集 token 用量、TTFT、TPS 等指标
 * 3. updateLogStreamContent — 流式请求记录生成的内容
 * 4. flushToolErrors — 写入待处理的工具错误日志
 *
 * 依赖：ctx.metadata 中需设置 "db"、"container"、"startTime"、
 *       "resilienceResult"、"isFailoverIteration"、"matcher"、"logFileWriter"、
 *       "pendingToolErrors"
 */
import Database from "better-sqlite3";
import { SERVICE_KEYS, type ServiceContainer } from "../../../core/container.js";
import type { PipelineHook, PipelineContext } from "../../pipeline/types.js";
import type { LogFileWriter } from "../../../storage/log-file-writer.js";
import type { RequestTracker } from "@llm-router/core/monitor";
import type { TransportResult } from "../../types.js";
import {
  logResilienceResult,
  collectTransportMetrics,
} from "../../proxy-logging.js";
import { updateLogStreamContent } from "../../../db/index.js";
import { logToolErrors } from "../../tool-error-logger.js";
import { getTransportStatusCode, serializeBlocksForStorage, detectClientAgentType } from "../../handler/proxy-handler-utils.js";
import type { FailedToolResult } from "../../handler/proxy-handler-utils.js";

export const requestLoggingHook: PipelineHook = {
  name: "builtin:request-logging",
  phase: "post_response",
  priority: 900,
  execute(ctx: PipelineContext): void | Promise<void> {
    const db = ctx.metadata.get("db") as Database.Database;
    const container = ctx.metadata.get("container") as ServiceContainer;
    const startTime = ctx.metadata.get("startTime") as number;
    const resilienceResult = ctx.metadata.get("resilienceResult") as {
      attempts: import("../../../core/types.js").ResilienceAttempt[];
      result: TransportResult;
    };
    const matcher = ctx.metadata.get("matcher") as { test: (statusCode: number, body: string) => boolean } | null;
    const logFileWriter = ctx.metadata.get("logFileWriter") as unknown;

    if (!db || !resilienceResult) return;

    const routerKeyId = (ctx.request.routerKey as { id?: string } | undefined)?.id ?? null;
    const isFailoverIteration = ctx.rootLogId !== null && ctx.rootLogId !== ctx.logId;
    const apiType = ctx.apiType as "openai" | "openai-responses" | "anthropic";

    // 1. 记录 resilience 结果日志
    const lastLogId = logResilienceResult(
      db,
      {
        apiType,
        model: ctx.clientModel,
        providerId: ctx.provider?.id ?? "",
        isStream: ctx.isStream,
        clientReq: ctx.clientRequest,
        upstreamReqBase: ctx.upstreamRequest,
        logId: ctx.logId,
        routerKeyId,
        originalModel: null,
        sessionId: ctx.sessionId,
        pipelineSnapshot: ctx.snapshot.toJSON(),
        failover: { isFailoverIteration, rootLogId: ctx.rootLogId ?? ctx.logId },
        matcher,
        logFileWriter: logFileWriter as LogFileWriter | null,
      },
      resilienceResult.attempts,
      resilienceResult.result,
      startTime,
    );

    // 2. 采集 transport 指标
    if (ctx.provider) {
      collectTransportMetrics(
        db,
        apiType,
        resilienceResult.result,
        ctx.isStream,
        lastLogId,
        ctx.provider.id,
        ctx.resolved?.backend_model ?? ctx.clientModel,
        ctx.request,
        routerKeyId,
        getTransportStatusCode(resilienceResult.result),
        ctx.metadata.get("client_type") as string | undefined,
        ctx.metadata.get("cache_read_tokens_estimated") as number | undefined,
      );
    }

    // 3. 流式请求记录内容
    if (ctx.isStream && container) {
      const tracker = container.resolve<RequestTracker>(SERVICE_KEYS.tracker);
      if (tracker) {
        const sc = tracker.get(ctx.logId)?.streamContent;
        const blocks = sc?.blocks;
        const hasStructured = blocks && blocks.length > 0 && blocks.some((b: { type: string }) => b.type !== "text");
        const content = hasStructured
          ? serializeBlocksForStorage(blocks, apiType)
          : (sc?.textContent || "");
        if (content) updateLogStreamContent(db, lastLogId, content);
      }
    }

    // 4. flush pending tool errors
    const pendingToolErrors = ctx.metadata.get("pendingToolErrors") as FailedToolResult[] | undefined;
    if (pendingToolErrors && ctx.provider) {
      logToolErrors(pendingToolErrors, {
        db,
        providerId: ctx.provider.id,
        backendModel: ctx.resolved?.backend_model ?? ctx.clientModel,
        clientAgentType: detectClientAgentType(ctx.request.headers as Record<string, string>),
        requestLogId: lastLogId,
        routerKeyId,
        sessionId: ctx.sessionId,
      });
      ctx.metadata.delete("pendingToolErrors");
    }
  },
};

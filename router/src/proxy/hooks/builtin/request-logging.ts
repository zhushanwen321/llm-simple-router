/**
 * post_response hook: 成功请求的日志记录和指标采集。
 *
 * 在请求成功完成后执行：
 * 1. logResilienceResult — 记录所有重试/failover 尝试日志
 * 2. collectTransportMetrics — 采集 token 用量、TTFT、TPS 等指标
 * 3. updateLogStreamContent — 流式请求记录生成的内容
 * 4. flushToolErrors — 写入待处理的工具错误日志
 *
 * 依赖：ctx.resilienceResult + ctx.transportResult（由 transport-execute hook 写入），
 *       ctx.metadata 中需设置 "db"、"container"、"startTime"、"matcher"、
 *       "logFileWriter"、"pendingToolErrors"、"effectiveMappingReason"、"lastFailoverTrigger"
 */
import { SERVICE_KEYS } from "../../../core/container.js";
import type { PipelineHook, PipelineContext } from "../../pipeline/types.js";
import type { RequestTracker } from "../../../core/monitor/index.js";
import {
  logResilienceResult,
  collectTransportMetrics,
} from "../../proxy-logging.js";
import { updateLogStreamContent } from "../../../db/index.js";
import { logToolErrors } from "../../tool-error-logger.js";
import { getTransportStatusCode, serializeBlocksForStorage } from "../../handler/proxy-handler-utils.js";
import type { FailedToolResult } from "../../handler/proxy-handler-utils.js";

export const requestLoggingHook: PipelineHook = {
  name: "builtin:request-logging",
  phase: "post_response",
  priority: 900,
  execute(ctx: PipelineContext): void | Promise<void> {
    const db = ctx.deps?.db;
    const container = ctx.deps?.container;
    const startTime = ctx.iterationStartTime ?? 0;
    const resilienceResult = ctx.resilienceResult;
    const matcher = ctx.deps?.matcher ?? null;
    const logFileWriter = ctx.deps?.logFileWriter ?? null;

    if (!db || !resilienceResult) return;

    const routerKeyId = (ctx.request.routerKey as { id?: string } | undefined)?.id ?? null;
    const sessionId = ctx.metadata.get("session_id") as string | undefined;
    const isFailoverIteration = ctx.rootLogId !== null && ctx.rootLogId !== ctx.logId;
    const apiType = ctx.apiType as "openai" | "openai-responses" | "anthropic";
    const effectiveMappingReason = ctx.mappingReason as string | null | undefined;
    const lastFailoverTrigger = ctx.lastFailoverTrigger as string | null | undefined;

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
        sessionId: sessionId,
        pipelineSnapshot: ctx.snapshot.toJSON(),
        failover: { isFailoverIteration, rootLogId: ctx.rootLogId ?? ctx.logId },
        matcher,
        logFileWriter: logFileWriter,
        resilienceAction: resilienceResult.finalDecision?.action,
        resilienceReason: resilienceResult.finalDecision?.action === "abort" ? resilienceResult.finalDecision.reason : null,
        mappingReason: effectiveMappingReason ?? null,
        failoverTrigger: lastFailoverTrigger ?? null,
      },
      resilienceResult.attempts,
      resilienceResult.result,
      startTime,
    );

    // 2. 采集 transport 指标
    if (ctx.provider) {
      const metricsTracker = container?.resolve<RequestTracker>(SERVICE_KEYS.tracker);
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
        sessionId,
        metricsTracker,
        ctx.metadata,
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
        clientAgentType: ctx.metadata.get("client_type") as string ?? "unknown",
        requestLogId: lastLogId,
        routerKeyId,
        sessionId: sessionId,
      });
      ctx.metadata.delete("pendingToolErrors");
    }
  },
};

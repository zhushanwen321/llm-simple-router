/**
 * Resilience result processing — 从 failover-loop.ts 提取。
 *
 * 处理 orchestrator 的 resilience 结果：日志记录、usage 统计、
 * 流式内容日志、failover 决策、错误响应格式化。
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { ProviderSwitchNeeded } from "../../core/errors.js";
import { SemaphoreQueueFullError, SemaphoreTimeoutError } from "../../core/errors.js";
import { updateLogClientStatus, insertRequestLog, updateLogStreamContent } from "../../db/index.js";
import { logUpstreamError, extractErrorInfo } from "../../db/upstream-error-logs.js";
import { logResilienceResult, collectTransportMetrics } from "../proxy-logging.js";
import { resolveEndpoint } from "../routing/resolve-endpoint.js";
import { getTransportStatusCode, serializeBlocksForStorage } from "./proxy-handler-utils.js";
import type { Target, MappingReason } from "../../core/types.js";
import type { PipelineContext } from "../pipeline/types.js";
import { PipelineAbort } from "../pipeline/types.js";
import type { RetryRuleMatcher } from "../orchestration/retry-rules.js";
import type { ProxyOrchestrator } from "../orchestration/orchestrator.js";
import type { RequestTracker } from "../../core/monitor/index.js";
import type { UsageWindowTracker } from "../routing/usage-window-tracker.js";
import type { FormatAdapter } from "../format/types.js";
import type { buildTransportFn } from "../transport/transport-fn.js";
import type { resolveMapping } from "../routing/mapping-resolver.js";
import type { LogFileWriter } from "../../storage/log-file-writer.js";
import type { RejectParams } from "./reject-helpers.js";
import { rejectAndReply } from "./reject-helpers.js";
import Database from "better-sqlite3";

const HTTP_ERROR_THRESHOLD = 400;
const UPSTREAM_ERROR_STATUS = 502;

// ---------- Resilience result processing ----------

export type ResilienceResultAction =
  | { action: "continue"; trigger: string | null }
  | { action: "reply"; reply: FastifyReply };

export async function processResilienceResult(params: {
  orchestrator: ProxyOrchestrator;
  request: FastifyRequest;
  reply: FastifyReply;
  clientApiType: "openai" | "openai-responses" | "anthropic";
  resolved: Target;
  provider: NonNullable<ReturnType<typeof import("../../db/index.js").getProviderById>>;
  clientModel: string;
  isStream: boolean;
  logId: string;
  sessionId: string | undefined;
  clientReq: string;
  upstreamReqBase: string;
  effectiveMappingReason: MappingReason;
  retryBaseDelayMs: number;
  isFailover: boolean;
  matcher: RetryRuleMatcher;
  transportFn: ReturnType<typeof buildTransportFn>;
  concurrencyOverride: NonNullable<ReturnType<typeof resolveMapping>>['concurrency_override'];
  db: Database.Database;
  tracker: RequestTracker;
  usageWindowTracker: UsageWindowTracker | undefined;
  errors: import("../proxy-core.js").ProxyErrorFormatter;
  rCtx: RejectParams;
  pipelineSnapshot: string;
  flushCurrentErrors: () => void;
  adapter: FormatAdapter;
  logFileWriter: LogFileWriter | null | undefined;
  resolvedEndpoint: ReturnType<typeof resolveEndpoint>;
  rootLogId: string;
  isFailoverIteration: boolean;
  ctx: PipelineContext;
  routerKeyId: string | null;
  lastFailoverTrigger: string | null;
  startTime: number;
}): Promise<ResilienceResultAction> {
  const {
    orchestrator, request, reply, clientApiType,
    resolved, provider, clientModel, isStream, logId, sessionId,
    clientReq, upstreamReqBase, concurrencyOverride: _concurrencyOverride, effectiveMappingReason,
    retryBaseDelayMs, isFailover, matcher, transportFn,
    db, tracker, usageWindowTracker, errors, rCtx,
    pipelineSnapshot, flushCurrentErrors, adapter, logFileWriter,
    resolvedEndpoint, rootLogId, isFailoverIteration, ctx, routerKeyId, lastFailoverTrigger,
    startTime,
  } = params;

  try {
    const resilienceResult = await orchestrator.handle(
      request, reply, clientApiType,
      { resolved, provider, clientModel, isStream, trackerId: logId, sessionId, clientRequest: clientReq, upstreamRequest: upstreamReqBase, concurrencyOverride: _concurrencyOverride, mappingReason: effectiveMappingReason },
      { retryBaseDelayMs, isFailover, ruleMatcher: matcher, transportFn },
    );

    // 日志记录
    const lastLogId = logResilienceResult(
      db,
      {
        apiType: clientApiType,
        model: clientModel, providerId: provider.id, isStream,
        clientReq, upstreamReqBase, logId, routerKeyId, originalModel: null, sessionId,
        failover: { isFailoverIteration, rootLogId },
        pipelineSnapshot,
        matcher, logFileWriter,
        resilienceAction: resilienceResult.finalDecision?.action,
        resilienceReason: resilienceResult.finalDecision?.action === "abort"
          ? (resilienceResult.finalDecision as { action: "abort"; reason: string }).reason
          : null,
        mappingReason: effectiveMappingReason,
        failoverTrigger: lastFailoverTrigger,
        upstreamApiType: resolvedEndpoint.api_type,
        upstreamBaseUrl: resolvedEndpoint.base_url,
      },
      resilienceResult.attempts, resilienceResult.result, startTime,
    );
    collectTransportMetrics(db, clientApiType, resilienceResult.result, isStream, lastLogId, provider.id, resolved.backend_model, request, routerKeyId, getTransportStatusCode(resilienceResult.result), ctx.metadata.get("client_type") as string | undefined, ctx.metadata.get("session_id") as string | undefined, tracker, ctx.metadata);

    // flush tool errors
    flushCurrentErrors();

    const tr = resilienceResult.result;
    const succeeded = tr.kind === "success" || tr.kind === "stream_success" || tr.kind === "stream_abort";
    if (succeeded) usageWindowTracker?.recordRequest(provider.id, routerKeyId ?? undefined);

    // 失败时写入 upstream_error_logs
    if (!succeeded) {
      const body = 'body' in tr ? tr.body : '';
      const { errorType, errorMessage } = extractErrorInfo(body);
      const trStatusCode = getTransportStatusCode(tr);
      if (trStatusCode !== null) {
        logUpstreamError(db, {
          request_log_id: lastLogId,
          provider_id: provider.id,
          backend_model: resolved.backend_model ?? clientModel,
          status_code: trStatusCode,
          error_type: errorType,
          error_message: errorMessage,
          client_agent_type: ctx.metadata.get("client_type") as string ?? "unknown",
          router_key_id: routerKeyId,
          session_id: ctx.metadata.get("session_id") as string | null ?? null,
          retry_count: resilienceResult.attempts.length - 1,
        });
      }
    }

    // 流式内容日志
    if (isStream && tracker) {
      const sc = tracker.get(logId)?.streamContent;
      const blocks = sc?.blocks;
      const hasStructured = blocks && blocks.length > 0 && blocks.some((b: { type: string }) => b.type !== "text");
      const content = hasStructured
        ? serializeBlocksForStorage(blocks, clientApiType)
        : (sc?.textContent || "");
      if (content) {
        updateLogStreamContent(db, lastLogId, content);
      }
    }

    // Failover 场景：如果失败且 headers 未发送，继续下一个 target
    if (isFailover && !reply.raw.headersSent) {
      const failed = tr.kind === "throw"
        || ("statusCode" in tr && tr.statusCode >= HTTP_ERROR_THRESHOLD);
      if (failed) {
        const trigger = tr.kind === "throw" ? "throw" : `status_${("statusCode" in tr ? tr.statusCode : 0)}`;
        return { action: "continue", trigger };
      }
    }

    // 发送响应（orchestrator 对部分场景不发送）
    if (!reply.raw.headersSent) {
      if (tr.kind === "success") {
        return { action: "reply", reply: reply.code(tr.statusCode).send(tr.body) };
      }
      if (tr.kind === "stream_error") {
        const trStatus = getTransportStatusCode(tr);
        if (trStatus !== null) updateLogClientStatus(db, lastLogId, trStatus);
        const formattedBody = adapter.formatError(
          'body' in tr ? tr.body : "stream error",
        ) ?? { error: { message: "stream error", type: "server_error" } };
        reply.header("content-type", "application/json");
        return { action: "reply", reply: reply.code(tr.statusCode).send(formattedBody) };
      }
      if (tr.kind === "throw" || (tr.kind === "error" && tr.statusCode >= HTTP_ERROR_THRESHOLD)) {
        const err = errors.upstreamConnectionFailed();
        updateLogClientStatus(db, lastLogId, err.statusCode);
        return { action: "reply", reply: reply.code(err.statusCode).send(err.body) };
      }
      // 未知 TransportResult kind 的兜底响应
      return { action: "reply", reply: reply.code(UPSTREAM_ERROR_STATUS).send(
        adapter.formatError("Unhandled transport result") ?? { error: { message: "Unhandled transport result", type: "server_error" } },
      ) };
    }

    return { action: "reply", reply };
  } catch (e: unknown) {
    if (e instanceof PipelineAbort) {
      return { action: "reply", reply: reply.code(e.statusCode).send(e.body) };
    }

    if (e instanceof ProviderSwitchNeeded) {
      if (reply.raw.headersSent) return { action: "reply", reply };
      // 补写失败日志
      if (e.attempts && e.attempts.length > 0) {
        const fakeResult = e.lastResult ?? { kind: "throw" as const, error: new Error("provider switch") };
        logResilienceResult(
          db,
          {
            apiType: clientApiType,
            model: clientModel, providerId: provider.id, isStream,
            clientReq, upstreamReqBase, logId, routerKeyId, originalModel: null, sessionId,
            failover: { isFailoverIteration, rootLogId },
            pipelineSnapshot,
            matcher, logFileWriter,
            resilienceAction: "failover",
            resilienceReason: "provider_switch_needed",
            mappingReason: effectiveMappingReason,
            failoverTrigger: e.constructor.name,
            upstreamApiType: resolvedEndpoint.api_type,
            upstreamBaseUrl: resolvedEndpoint.base_url,
          },
          e.attempts, fakeResult, startTime,
        );
      }
      flushCurrentErrors();
      return { action: "continue", trigger: e.constructor.name };
    }

    if (e instanceof SemaphoreQueueFullError) {
      return {
        action: "reply",
        reply: rejectAndReply(reply, rCtx, errors.concurrencyQueueFull(provider.id),
          `Concurrency queue full for provider '${provider.id}'`, provider.id,
          flushCurrentErrors),
      };
    }
    if (e instanceof SemaphoreTimeoutError) {
      return {
        action: "reply",
        reply: rejectAndReply(reply, rCtx, errors.concurrencyTimeout(provider.id, (e as SemaphoreTimeoutError).timeoutMs),
          `Concurrency wait timeout for provider '${provider.id}' (${(e as SemaphoreTimeoutError).timeoutMs}ms)`, provider.id,
          flushCurrentErrors),
      };
    }

    // 请求被主动 kill（abort + reply destroy），直接退出不写日志
    if (e instanceof Error && e.name === "AbortError") {
      return { action: "reply", reply };
    }

    // 其他未知错误
    const errMsg = e instanceof Error ? e.message : JSON.stringify(e);
    request.log.debug({ logId, error: errMsg, action: "upstream_error" });
    insertRequestLog(db, {
      id: logId, api_type: clientApiType,
      model: clientModel, provider_id: provider.id,
      status_code: UPSTREAM_ERROR_STATUS, latency_ms: Date.now() - startTime, is_stream: isStream ? 1 : 0,
      error_message: errMsg || "Upstream connection failed", created_at: new Date().toISOString(),
      client_request: clientReq, upstream_request: upstreamReqBase,
      is_failover: isFailoverIteration ? 1 : 0, original_request_id: isFailoverIteration ? rootLogId : null,
      router_key_id: routerKeyId, original_model: null,
      session_id: ctx.metadata.get("session_id") as string | undefined,
      pipeline_snapshot: pipelineSnapshot,
      transport_kind: "throw",
      mapping_reason: rCtx.mappingReason ?? null,
      upstream_api_type: resolvedEndpoint.api_type,
      upstream_base_url: resolvedEndpoint.base_url,
      backend_model: resolved.backend_model,
    }, (matcher || logFileWriter) ? {
      matcher, logFileWriter, responseBody: null,
    } : undefined);
    flushCurrentErrors();
    const err = errors.upstreamConnectionFailed();
    return { action: "reply", reply: reply.code(err.statusCode).send(err.body) };
  }
}

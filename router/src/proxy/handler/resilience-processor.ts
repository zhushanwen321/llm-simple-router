/**
 * Resilience result processing — 从 failover-loop.ts 提取。
 *
 * 处理 orchestrator 的 resilience 结果：日志记录、usage 统计、
 * 流式内容日志、failover 决策、错误响应格式化。
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { ProviderSwitchNeeded } from "../../core/errors.js";
import { SemaphoreQueueFullError, SemaphoreTimeoutError } from "../../core/errors.js";
import { updateLogClientStatus, insertRequestLog, updateLogStreamContent, getProviderById } from "../../db/index.js";
import { logUpstreamError, extractErrorInfo } from "../../db/upstream-error-logs.js";
import { logResilienceResult, collectTransportMetrics } from "../proxy-logging.js";
import { resolveEndpoint } from "../routing/resolve-endpoint.js";
import { getTransportStatusCode, serializeBlocksForStorage } from "./proxy-handler-utils.js";
import { getSessionBinding, upsertSessionBinding, type SessionBinding } from "../../db/session-states.js";
import type { CircuitBreaker } from "../routing/circuit-breaker.js";
import type { Target, MappingReason, ResolveResult, TransportResult, CircuitBreakerConfig } from "../../core/types.js";
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
/** provider.is_active 的活跃值（数据库存 0/1） */
const PROVIDER_ACTIVE = 1;

// ---------- Error type handling for resilience catch block ----------

interface ErrorHandlerContext {
  reply: FastifyReply;
  request: FastifyRequest;
  db: Database.Database;
  errors: import("../proxy-core.js").ProxyErrorFormatter;
  rCtx: RejectParams;
  provider: NonNullable<ReturnType<typeof import("../../db/index.js").getProviderById>>;
  clientApiType: "openai" | "openai-responses" | "anthropic";
  clientModel: string;
  isStream: boolean;
  logId: string;
  sessionId: string | undefined;
  clientReq: string;
  upstreamReqBase: string;
  routerKeyId: string | null;
  pipelineSnapshot: string;
  matcher: RetryRuleMatcher;
  logFileWriter: LogFileWriter | null | undefined;
  resolved: Target;
  resolvedEndpoint: ReturnType<typeof resolveEndpoint>;
  rootLogId: string;
  isFailoverIteration: boolean;
  ctx: PipelineContext;
  rCtxMappingReason: string | null;
  flushCurrentErrors: () => void;
  startTime: number;
}

function handleResilienceError(
  e: unknown,
  ctx: ErrorHandlerContext,
): ResilienceResultAction {
  const {
    reply, request, db, errors, rCtx, provider,
    clientApiType, clientModel, isStream, logId, sessionId,
    clientReq, upstreamReqBase, routerKeyId, pipelineSnapshot,
    matcher, logFileWriter, resolved, resolvedEndpoint,
    rootLogId, isFailoverIteration, ctx: pipelineCtx,
    rCtxMappingReason, flushCurrentErrors, startTime,
  } = ctx;

  if (e instanceof PipelineAbort) {
    return { action: "reply", reply: reply.code(e.statusCode).send(e.body) };
  }

  if (e instanceof ProviderSwitchNeeded) {
    if (reply.raw.headersSent) return { action: "reply", reply };
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
          mappingReason: pipelineCtx.metadata.get("mappingReason") as string | undefined ?? "direct",
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
      reply: rejectAndReply(reply, rCtx, errors.concurrencyTimeout(provider.id, e.timeoutMs),
        `Concurrency wait timeout for provider '${provider.id}' (${e.timeoutMs}ms)`, provider.id,
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
    session_id: pipelineCtx.metadata.get("session_id") as string | undefined,
    pipeline_snapshot: pipelineSnapshot,
    transport_kind: "throw",
    mapping_reason: rCtxMappingReason,
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

// ---------- Circuit breaker counting + session binding (design §4.5 + §3) ----------

/**
 * 判定一次结果是否应计入熔断事件，返回 ok 值或 null（不计）。
 *
 * 设计文档 §4.5 计数表：
 * - throw（连接级错误）→ fail（不受 status_codes 白名单限制，始终计入）
 * - statusCode>=400 且白名单内 → fail；白名单外 → 不计（不稀释失败率分母）
 * - success/stream_success/stream_abort → ok
 * - stream_error（statusCode<400，未达阈值无失败语义）→ 不计
 */
function countCircuitEvent(tr: TransportResult, cbConfig: CircuitBreakerConfig): boolean | null {
  if (tr.kind === "throw") return false;
  const trStatusCode = getTransportStatusCode(tr);
  if (trStatusCode !== null && trStatusCode >= HTTP_ERROR_THRESHOLD) {
    const inWhitelist = !cbConfig.status_codes || cbConfig.status_codes.includes(trStatusCode);
    return inWhitelist ? false : null;
  }
  if (tr.kind === "success" || tr.kind === "stream_success" || tr.kind === "stream_abort") return true;
  return null;
}

/**
 * 判定绑定模型是否已失效（设计文档 §3 条件③）。任一成立即失效：
 * - 绑定模型不在配置级目标集合中（配置删除/变更）
 * - 绑定 provider 已停用（is_active !== 1）
 * - 绑定模型熔断中（OPEN 且冷却未过）
 */
function isBindingInvalidated(
  binding: SessionBinding,
  resolveResult: ResolveResult,
  cachedTargets: Target[],
  db: Database.Database,
  circuitBreaker: CircuitBreaker,
): boolean {
  // 绑定 provider 缺失视为失效
  if (!binding.providerId) return true;

  // ③a：绑定模型不在配置级目标集合中
  const bindingKey = `${binding.providerId}:${binding.currentModel}`;
  if (resolveResult.configLevelTargetKeys && !resolveResult.configLevelTargetKeys.has(bindingKey)) {
    return true;
  }

  // ③b：绑定 provider 已停用
  const provider = getProviderById(db, binding.providerId);
  if (!provider || provider.is_active !== PROVIDER_ACTIVE) return true;

  // ③c：绑定模型熔断中（OPEN 且冷却未过）。用只读 isOpenAndCooling 避免 shouldSkip 副作用
  // （shouldSkip 在冷却结束时转 CLOSED + 清空 events，绑定失效判定不应改变状态机）
  const bindingTarget = cachedTargets.find(
    t => t.provider_id === binding.providerId && t.backend_model === binding.currentModel,
  );
  if (bindingTarget?.circuit_breaker?.enabled) {
    const key = circuitBreaker.buildCircuitKey(
      resolveResult.group_id ?? null,
      resolveResult.schedule_id,
      bindingTarget.provider_id,
      bindingTarget.backend_model,
    );
    if (key !== null && circuitBreaker.isOpenAndCooling(key, bindingTarget.circuit_breaker, Date.now())) {
      return true;
    }
  }
  return false;
}

/**
 * 判定是否应写入/刷新 Session 绑定（设计文档 §3 绑定写入规则）。
 * 满足任一条件即写：① 无绑定；② 成功模型==绑定模型（刷新）；③ 绑定模型已失效（覆盖）。
 */
function shouldUpsertBinding(
  existingBinding: SessionBinding | null,
  resolveResult: ResolveResult,
  cachedTargets: Target[],
  resolved: Target,
  db: Database.Database,
  circuitBreaker: CircuitBreaker,
): boolean {
  if (existingBinding === null) return true;
  if (existingBinding.providerId === resolved.provider_id
    && existingBinding.currentModel === resolved.backend_model) {
    return true;
  }
  return isBindingInvalidated(existingBinding, resolveResult, cachedTargets, db, circuitBreaker);
}

/**
 * 熔断计数 + Session 绑定写入（设计文档 §4.5 + §3）。
 *
 * 内部自带「链上有 CB target」门控：无配置则零开销返回（§4.5 门控承诺）。
 * 调用方负责 circuitBreaker 非 undefined（未注册 CB 单例时不应调用）。
 */
export function applyCircuitBreakerAndBinding(args: {
  circuitBreaker: CircuitBreaker;
  cachedTargets: Target[];
  resolveResult: ResolveResult;
  resolved: Target;
  tr: TransportResult;
  finalDecision: { action?: string } | undefined;
  db: Database.Database;
  sessionId: string | undefined;
  routerKeyId: string | null;
}): void {
  const { circuitBreaker, cachedTargets, resolveResult, resolved, tr, finalDecision, db, sessionId, routerKeyId } = args;

  // 门控：链上无 CB target → 零开销
  if (!cachedTargets.some(t => t.circuit_breaker?.enabled)) return;

  // client_aborted 短路：不计任何事件（设计文档 §4.5）
  const isClientAborted = finalDecision?.action === "abort"
    && (finalDecision as { action: "abort"; reason: string }).reason === "client_aborted";
  if (isClientAborted) return;

  // 计数（仅对配置了 CB 的 target 构造 key，非 CB target 不积累永不消费的 events）
  const cbConfig = resolved.circuit_breaker;
  if (cbConfig?.enabled) {
    const cbKey = circuitBreaker.buildCircuitKey(
      resolveResult.group_id ?? null,
      resolveResult.schedule_id,
      resolved.provider_id,
      resolved.backend_model,
    );
    if (cbKey !== null) {
      const ok = countCircuitEvent(tr, cbConfig);
      if (ok !== null) circuitBreaker.recordResult(cbKey, ok, cbConfig, Date.now());
    }
  }

  // 绑定写入：仅成功（success/stream_success；stream_abort 不写绑定）时评估
  const isBindingSuccess = tr.kind === "success" || tr.kind === "stream_success";
  const groupId = resolveResult.group_id;
  if (!isBindingSuccess || !sessionId || !routerKeyId || !groupId) return;

  const existingBinding = getSessionBinding(db, routerKeyId, sessionId, groupId);
  if (shouldUpsertBinding(existingBinding, resolveResult, cachedTargets, resolved, db, circuitBreaker)) {
    upsertSessionBinding(db, routerKeyId, sessionId, groupId, resolved.provider_id, resolved.backend_model);
  }
}

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
  /** 全局熔断状态机（未注册时为 undefined，CB 逻辑零开销跳过） */
  circuitBreaker?: CircuitBreaker;
  /** 本次请求的运行时链（含 overflow 扩展目标），供写入门控判定 */
  cachedTargets: Target[];
  /** 映射解析结果（含 group_id/schedule_id/configLevelTargetKeys），熔断 key 构造 + 绑定失效判定用 */
  resolveResult: ResolveResult;
}): Promise<ResilienceResultAction> {
  const {
    orchestrator, request, reply, clientApiType,
    resolved, provider, clientModel, isStream, logId, sessionId,
    clientReq, upstreamReqBase, concurrencyOverride, effectiveMappingReason,
    retryBaseDelayMs, isFailover, matcher, transportFn,
    db, tracker, usageWindowTracker, errors, rCtx,
    pipelineSnapshot, flushCurrentErrors, adapter, logFileWriter,
    resolvedEndpoint, rootLogId, isFailoverIteration, ctx, routerKeyId, lastFailoverTrigger,
    startTime, circuitBreaker, cachedTargets, resolveResult,
  } = params;

  try {
    const resilienceResult = await orchestrator.handle(
      request, reply, clientApiType,
      { resolved, provider, clientModel, isStream, trackerId: logId, sessionId, clientRequest: clientReq, upstreamRequest: upstreamReqBase, concurrencyOverride, mappingReason: effectiveMappingReason },
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

    // 熔断计数 + Session 绑定写入（设计文档 §4.5 + §3）；circuitBreaker 未注册时跳过
    if (circuitBreaker) {
      applyCircuitBreakerAndBinding({
        circuitBreaker, cachedTargets, resolveResult, resolved,
        tr, finalDecision: resilienceResult.finalDecision,
        db, sessionId, routerKeyId,
      });
    }

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
    return handleResilienceError(e, {
      reply, request, db, errors, rCtx, provider,
      clientApiType, clientModel, isStream, logId, sessionId,
      clientReq, upstreamReqBase, routerKeyId, pipelineSnapshot,
      matcher, logFileWriter, resolved, resolvedEndpoint,
      rootLogId, isFailoverIteration, ctx,
      rCtxMappingReason: rCtx.mappingReason ?? null,
      flushCurrentErrors, startTime,
    });
  }
}

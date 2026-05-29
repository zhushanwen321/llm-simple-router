/**
 * Failover 循环 — L1 预计算 + L2 Pipeline emit + L3 循环控制壳。
 *
 * L1: 循环前路由决策（resolveMapping → IR → OF → allowed_models 过滤）
 * L2: 每次 iter 通过 pipeline emit 执行 route → transform → transport
 * L3: 结果处理、日志记录、failover 判断
 */
import { randomUUID } from "crypto";
import type { FastifyReply } from "fastify";
import { SemaphoreQueueFullError, SemaphoreTimeoutError } from "../../core/errors.js";
import { type Target, type MappingReason } from "../../core/types.js";
import { type ServiceContainer, SERVICE_KEYS } from "../../core/container.js";
import { resolveMapping, filterExcluded } from "../routing/mapping-resolver.js";
import { expandOverflowTargets } from "../routing/overflow.js";
import { computeModalityRedirectTargets } from "../routing/modality-redirect.js";
import { getConfig } from "../../config/index.js";
import { insertRejectedLog } from "../log-helpers.js";
import { logResilienceResult, sanitizeHeadersForLog } from "../proxy-logging.js";
import { loadEnhancementConfig } from "../routing/enhancement-config.js";
import { extractFailedToolResults } from "./proxy-handler-utils.js";
import { logToolErrors } from "../tool-error-logger.js";
import { PipelineAbort, type PipelineContext, type ProviderInfo } from "../pipeline/types.js";
import { PipelineSnapshot } from "../pipeline-snapshot.js";
import type { ILogSink } from "../../core/log-sink.js";
import { proxyPipeline } from "../pipeline/pipeline.js";
import type { ProxyErrorFormatter } from "../proxy-core.js";
import type { FormatAdapter } from "../format/types.js";
import type { RawHeaders } from "../types.js";
import type { RetryRuleMatcher } from "../orchestration/retry-rules.js";
import type { ProxyOrchestrator } from "../orchestration/orchestrator.js";
import type { RequestTracker } from "../../core/monitor/index.js";
import type { UsageWindowTracker } from "../routing/usage-window-tracker.js";
import type { ProxyAgentFactory } from "../transport/proxy-agent.js";
import Database from "better-sqlite3";

const UPSTREAM_ERROR_STATUS = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;
const MAX_FAILOVER_ITERATIONS = 10;

// ---------- Dependencies（保持接口不变） ----------

export interface FailoverLoopDeps {
  db: Database.Database;
  container: ServiceContainer;
  orchestrator: ProxyOrchestrator;
  proxyAgentFactory?: ProxyAgentFactory;
  logSink?: ILogSink;
}

// ---------- Reject helper ----------

interface RejectParams {
  db: Database.Database; logId: string; apiType: string; model: string;
  startTime: number; isStream: boolean; routerKeyId: string | null;
  originalBody: Record<string, unknown>; clientHeaders: RawHeaders;
  isFailover: boolean; originalRequestId: string | null;
  sessionId: string | undefined; pipelineSnapshot?: string;
  matcher?: RetryRuleMatcher;
  logFileWriter?: import("../../storage/log-file-writer.js").LogFileWriter | null;
  mappingReason?: string | null;
}

function rejectAndReply(
  reply: FastifyReply, p: RejectParams,
  error: { statusCode: number; body: unknown }, msg: string,
  providerId?: string,
): FastifyReply {
  insertRejectedLog({
    db: p.db, logId: p.logId, apiType: p.apiType as "openai" | "openai-responses" | "anthropic",
    model: p.model, statusCode: error.statusCode, errorMessage: msg, startTime: p.startTime,
    isStream: p.isStream, routerKeyId: p.routerKeyId, originalBody: p.originalBody,
    clientHeaders: p.clientHeaders, providerId: providerId ?? null, originalModel: null,
    isFailover: p.isFailover, originalRequestId: p.originalRequestId, sessionId: p.sessionId,
    pipelineSnapshot: p.pipelineSnapshot, matcher: p.matcher, logFileWriter: p.logFileWriter,
    mapping_reason: p.mappingReason ?? null,
  });
  return reply.code(error.statusCode).send(error.body);
}

// ---------- L1 预计算辅助 ----------

function applyAllowedModelsFilter(targets: Target[], allowed: string[] | undefined, ofIdx: Set<number>):
  { targets: Target[]; overflowIndices: Set<number> } {
  if (!allowed?.length) return { targets, overflowIndices: ofIdx };
  const newOfIdx = new Set<number>();
  const filtered: Target[] = [];
  for (let i = 0; i < targets.length; i++) {
    if (allowed.includes(targets[i].backend_model)) {
      if (ofIdx.has(i)) newOfIdx.add(filtered.length);
      filtered.push(targets[i]);
    }
  }
  return { targets: filtered, overflowIndices: newOfIdx };
}

function makeRejectCtx(
  ctx: PipelineContext, db: Database.Database, logId: string, cliHdrs: RawHeaders,
  matcher: RetryRuleMatcher | undefined, logFileWriter: import("../../storage/log-file-writer.js").LogFileWriter | undefined,
  snapshot: PipelineSnapshot, extra?: Partial<RejectParams>,
): RejectParams {
  return {
    db, logId, apiType: ctx.apiType, model: ctx.clientModel, startTime: Date.now(),
    isStream: (ctx.body as Record<string, unknown>).stream === true,
    routerKeyId: ctx.request.routerKey?.id ?? null, originalBody: ctx.rawBody,
    clientHeaders: cliHdrs, isFailover: false, originalRequestId: null,
    sessionId: ctx.metadata.get("session_id") as string | undefined,
    pipelineSnapshot: snapshot.toJSON(), matcher, logFileWriter, ...extra,
  };
}

// ---------- Main failover loop ----------

/** L1 路由预计算的结果 */
interface PrecomputeResult {
  allTargets: Target[];
  overflowIndices: Set<number>;
  resolveResult: import("../../core/types.js").ResolveResult;
  precomputeSnapshot: PipelineSnapshot;
  enhancementConfig: import("../routing/enhancement-config.js").EnhancementConfig;
  pendingToolErrors: import("./proxy-handler-utils.js").FailedToolResult[] | null;
  precomputedClientReq: string;
  rejectReply: FastifyReply | null;
}

/** L1: 路由预计算 — resolveMapping → IR → OF → allowed_models filter */
function precomputeRoutes(
  ctx: PipelineContext,
  errors: ProxyErrorFormatter,
  db: Database.Database,
  cliHdrs: RawHeaders,
  matcher: RetryRuleMatcher | undefined,
  logFileWriter: import("../../storage/log-file-writer.js").LogFileWriter | undefined,
): PrecomputeResult {
  const { request, reply } = ctx;
  const rawBody = ctx.rawBody;
  const clientModel = ctx.clientModel;
  const enhancementConfig = loadEnhancementConfig(db);
  const precomputeSnapshot = new PipelineSnapshot();
  const precomputedClientReq = JSON.stringify({ headers: sanitizeHeadersForLog(cliHdrs as Record<string, string>), body: rawBody });

  const resolveResult = resolveMapping(db, clientModel, { now: new Date() });
  if (!resolveResult) {
    return {
      allTargets: [], overflowIndices: new Set(), resolveResult: null as never,
      precomputeSnapshot, enhancementConfig, pendingToolErrors: null,
      precomputedClientReq, rejectReply: rejectAndReply(reply, makeRejectCtx(ctx, db, randomUUID(), cliHdrs, matcher, logFileWriter, precomputeSnapshot),
        errors.modelNotFound(clientModel), `No mapping found for model '${clientModel}'`),
    };
  }

  let allTargets = resolveResult.allTargets ?? [resolveResult.target];
  allTargets = computeModalityRedirectTargets(db, allTargets, clientModel, ctx.body, precomputeSnapshot);

  if (allTargets.length === 0) {
    return {
      allTargets: [], overflowIndices: new Set(), resolveResult,
      precomputeSnapshot, enhancementConfig, pendingToolErrors: null,
      precomputedClientReq, rejectReply: rejectAndReply(reply, makeRejectCtx(ctx, db, randomUUID(), cliHdrs, matcher, logFileWriter, precomputeSnapshot),
        errors.unsupportedModality(), `No eligible target: request modalities not supported by any available model`),
    };
  }

  const beforeOF = allTargets.length;
  const ofResult = expandOverflowTargets(allTargets, db, ctx.body);
  allTargets = ofResult.targets;
  precomputeSnapshot.add({ stage: "overflow", triggered: allTargets.length > beforeOF });

  const { targets: filteredTargets, overflowIndices } = applyAllowedModelsFilter(
    allTargets, request.routerKey?.allowed_models ?? undefined, ofResult.overflowIndices);
  if (filteredTargets.length === 0) {
    return {
      allTargets: [], overflowIndices, resolveResult,
      precomputeSnapshot, enhancementConfig, pendingToolErrors: null,
      precomputedClientReq, rejectReply: rejectAndReply(reply, makeRejectCtx(ctx, db, randomUUID(), cliHdrs, matcher, logFileWriter, precomputeSnapshot),
        errors.modelNotAllowed(clientModel), `No allowed model available for '${clientModel}'`),
    };
  }

  // 工具错误提取
  let pendingToolErrors: import("./proxy-handler-utils.js").FailedToolResult[] | null = null;
  if (enhancementConfig.tool_error_logging_enabled) {
    const failures = extractFailedToolResults(ctx.body);
    if (failures.length > 0) {
      request.log.info({ failures: failures.length }, "Tool error results detected");
      pendingToolErrors = failures;
    }
  }

  return {
    allTargets: filteredTargets, overflowIndices, resolveResult,
    precomputeSnapshot, enhancementConfig, pendingToolErrors,
    precomputedClientReq, rejectReply: null,
  };
}
export async function executeFailoverLoop(
  ctx: PipelineContext, errors: ProxyErrorFormatter,
  deps: FailoverLoopDeps, upstreamPath: string, adapter: FormatAdapter,
): Promise<FastifyReply> {
  const { request, reply } = ctx;
  const { db, container, orchestrator } = deps;
  const config = getConfig();
  const tracker = container.resolve<RequestTracker>(SERVICE_KEYS.tracker);
  const usageWindowTracker = container.resolve<UsageWindowTracker>(SERVICE_KEYS.usageWindowTracker);
  const matcher = container.resolve<RetryRuleMatcher>(SERVICE_KEYS.matcher);
  const logFileWriter = container.resolve<import("../../storage/log-file-writer.js").LogFileWriter>(SERVICE_KEYS.logFileWriter);
  const cliHdrs = request.headers as RawHeaders;

  // === L1: 路由预计算（纯函数，无副作用） ===
  const precomputeResult = precomputeRoutes(ctx, errors, db, cliHdrs, matcher, logFileWriter ?? undefined);
  if (precomputeResult.rejectReply) return precomputeResult.rejectReply;

  const {
    allTargets, overflowIndices, resolveResult, precomputeSnapshot,
    enhancementConfig, pendingToolErrors, precomputedClientReq,
  } = precomputeResult;
  let mutablePendingToolErrors = pendingToolErrors;
  const rawBody = ctx.rawBody;
  const clientModel = ctx.clientModel;

  // === L1 → L2 通道（注入到 ctx.deps） ===
  ctx.deps!.setup.db = db;
  ctx.deps!.setup.container = container;
  ctx.deps!.setup.orchestrator = orchestrator;
  ctx.deps!.setup.matcher = matcher;
  ctx.deps!.setup.tracker = tracker;
  ctx.deps!.setup.retryBaseDelayMs = config.RETRY_BASE_DELAY_MS;
  ctx.deps!.setup.logFileWriter = logFileWriter;
  ctx.deps!.setup.errors = errors;
  ctx.deps!.setup.usageWindowTracker = usageWindowTracker;
  if (deps.logSink) ctx.deps!.setup.logSink = deps.logSink;

  ctx.deps!.request!.cachedTargets = allTargets;
  ctx.deps!.request!.overflowIndices = overflowIndices;
  ctx.deps!.request!.resolveResult = resolveResult;
  ctx.deps!.request!.precomputeSnapshot = precomputeSnapshot;
  ctx.deps!.request!.decryptedApiKeys = new Map<string, string>();
  ctx.deps!.request!.enhancementConfig = enhancementConfig;
  ctx.deps!.request!.adapter = adapter;
  ctx.deps!.request!.defaultUpstreamPath = upstreamPath;
  ctx.deps!.request!.clientHeaders = cliHdrs;
  ctx.deps!.request!.precomputedClientReq = precomputedClientReq;
  ctx.deps!.request!.concurrencyOverride = resolveResult.concurrency_override ?? null;

  if (mutablePendingToolErrors) ctx.metadata.set("pendingToolErrors", mutablePendingToolErrors);

  // === L3: while(true) 循环壳 ===
  const excludeTargets: Target[] = [];
  let rootLogId: string | null = null;
  let lastFailoverTrigger: string | null = null;
  let iteration = 0;

  while (true) {
    if (reply.raw.destroyed) return reply;
    if (++iteration > MAX_FAILOVER_ITERATIONS) {
      return reply.code(HTTP_SERVICE_UNAVAILABLE).send({
        error: { message: `Max failover iterations (${MAX_FAILOVER_ITERATIONS}) exceeded`, type: "server_error", code: "failover_limit_exceeded" },
      });
    }

    const startTime = Date.now();
    const logId = randomUUID();
    if (rootLogId === null) rootLogId = logId;
    const isFailoverIter = rootLogId !== logId;
    const routerKeyId = request.routerKey?.id ?? null;

    // effectiveMappingReason
    let mapReason: MappingReason = isFailoverIter ? "failover_retry" : resolveResult.mappingReason;
    const avail = filterExcluded(allTargets, excludeTargets);
    if (avail.length > 0) {
      const r = avail[0];
      if (overflowIndices.has(allTargets.findIndex(t => t.provider_id === r.provider_id && t.backend_model === r.backend_model))) {
        mapReason = "overflow_redirect";
      }
    }

    // 重置迭代级 context
    ctx.body = { ...rawBody };
    ctx.isStream = ctx.body.stream === true;
    ctx.resolved = null as Target | null;
    ctx.provider = null as ProviderInfo | null;
    ctx.logId = logId;
    ctx.rootLogId = rootLogId;
    ctx.transportResult = null;
    ctx.resilienceResult = null;
    ctx.clientRequest = precomputedClientReq;
    ctx.upstreamRequest = "";
    ctx.snapshot = new PipelineSnapshot(precomputeSnapshot.getStages());
    // 迭代级字段（通过 ctx 直接属性访问为主）
    ctx.excludeTargets = excludeTargets;
    ctx.iterationStartTime = startTime;
    ctx.isFailoverIteration = isFailoverIter;
    ctx.mappingReason = mapReason;

    const flushToolErrors = (pId: string, model: string) => {
      if (!mutablePendingToolErrors) return;
      logToolErrors(mutablePendingToolErrors, { db, providerId: pId, backendModel: model,
        clientAgentType: ctx.metadata.get("client_type") as string ?? "unknown",
        requestLogId: logId, routerKeyId, sessionId: ctx.metadata.get("session_id") as string | undefined });
    };

    const snapshot = ctx.snapshot.toJSON();
    const rCtx: RejectParams = {
      db, logId, apiType: ctx.apiType, model: clientModel, startTime,
      isStream: ctx.isStream, routerKeyId, originalBody: rawBody, clientHeaders: cliHdrs,
      isFailover: isFailoverIter, originalRequestId: isFailoverIter ? rootLogId : null,
      sessionId: ctx.metadata.get("session_id") as string | undefined,
      pipelineSnapshot: snapshot, matcher, logFileWriter, mappingReason: mapReason,
    };

    // 循环内：检查是否还有可用 target
    if (avail.length === 0) {
      return rejectAndReply(reply, rCtx, errors.upstreamConnectionFailed(),
        `All failover targets exhausted (${excludeTargets.length} attempted)`);
    }

    try {
      // L2: Pipeline emit
      await proxyPipeline.emit("post_route", ctx);

      // routing snapshot 阶段（hook 不负责写入）
      ctx.snapshot.add({
        stage: "routing", client_model: clientModel, backend_model: ctx.resolved!.backend_model,
        provider_id: ctx.resolved!.provider_id, strategy: allTargets.length > 1 ? "failover" : "scheduled",
        mapping_reason: mapReason,
      });

      await proxyPipeline.emit("pre_transport", ctx);

      // 注入 lastFailoverTrigger 供 request-logging hook 读取
      ctx.lastFailoverTrigger = lastFailoverTrigger;
      await proxyPipeline.emit("post_response", ctx);

      // L3: 结果处理（日志已由 request-logging hook 完成）
      const rr = ctx.resilienceResult!;
      const tr = rr.result;

      // 根据 resilience action 决策
      // action-based failover/retry: 记录 resilience 结果后继续循环
      if (rr.action === 'failover' || rr.action === 'retry') {
        if (!reply.raw.headersSent) {
          logResilienceResult(db, {
            apiType: ctx.apiType as "openai" | "openai-responses" | "anthropic",
            model: clientModel, providerId: ctx.provider?.id ?? "", isStream: ctx.isStream,
            clientReq: ctx.clientRequest, upstreamReqBase: ctx.upstreamRequest, logId, routerKeyId,
            originalModel: null, sessionId: ctx.metadata.get("session_id") as string | undefined,
            failover: { isFailoverIteration: isFailoverIter, rootLogId: rootLogId! },
            pipelineSnapshot: ctx.snapshot.toJSON(), matcher, logFileWriter, resilienceAction: rr.action,
            resilienceReason: "resilience_action", mappingReason: mapReason,
            failoverTrigger: `action_${rr.action}`,
          }, rr.attempts, rr.result, startTime);
          if (ctx.provider) flushToolErrors(ctx.provider.id, ctx.resolved?.backend_model ?? clientModel);
          mutablePendingToolErrors = null;
          lastFailoverTrigger = rr.action;
          excludeTargets.push(ctx.resolved!);
          continue;
        }
        return reply;
      }

      // stop 且有其他可用 target: 外层的 failover 循环继续尝试
      if (rr.action === 'stop' && allTargets.length > 1 && !reply.raw.headersSent) {
        lastFailoverTrigger = `action_stop`;
        excludeTargets.push(ctx.resolved!);
        continue;
      }

      if (!reply.raw.headersSent) {
        if (rr.action === 'continue' && "statusCode" in tr && "body" in tr) {
          return reply.code(tr.statusCode).send(tr.body);
        }
        // rr.action === 'stop'（无更多 target 可切换）
        const errResp = errors.upstreamConnectionFailed();
        return reply.code(errResp.statusCode).send(errResp.body);
      }
      return reply;

    } catch (e: unknown) {
      if (e instanceof PipelineAbort) {
        if (reply.raw.headersSent) return reply;
        return reply.code(e.statusCode).send(e.body);
      }
      // ProviderSwitchNeeded 不再由 resilience 层抛出，外部 plugin 抛出的此异常
      // 根据 Constraint #7 应传播到顶层（不在此处捕获）
      if (e instanceof SemaphoreQueueFullError) {
        if (ctx.provider) flushToolErrors(ctx.provider.id, ctx.resolved?.backend_model ?? clientModel);
        return rejectAndReply(reply, rCtx, errors.concurrencyQueueFull(e.providerId),
          `Concurrency queue full for provider '${e.providerId}'`, e.providerId);
      }
      if (e instanceof SemaphoreTimeoutError) {
        if (ctx.provider) flushToolErrors(ctx.provider.id, ctx.resolved?.backend_model ?? clientModel);
        return rejectAndReply(reply, rCtx, errors.concurrencyTimeout(e.providerId, e.timeoutMs),
          `Concurrency wait timeout for provider '${e.providerId}' (${e.timeoutMs}ms)`, e.providerId);
      }
      if (e instanceof Error && e.name === "AbortError") return reply;
      // 设置 errorInfo 供 on_error hooks（error-logging 等）使用
      const errMsg = e instanceof Error ? e.message : JSON.stringify(e);
      ctx.metadata.set("errorInfo", {
        statusCode: UPSTREAM_ERROR_STATUS,
        errorMessage: errMsg || "Upstream connection failed",
        providerId: ctx.provider?.id,
      });
      try { await proxyPipeline.emit("on_error", ctx); } catch (emitErr) { ctx.request.log.debug({ err: emitErr }, "on_error emit failed"); }
      request.log.debug({ logId, error: errMsg, action: "upstream_error" });
      const err = errors.upstreamConnectionFailed();
      return reply.code(err.statusCode).send(err.body);
    }
  }
}

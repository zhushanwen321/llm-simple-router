/**
 * Failover 循环 — 从 executeFailoverLoop() 提取。
 *
 * 每次迭代：
 * 1. 通过 ProxyPipeline 执行完整的 route → transform → transport 流程
 * 2. 处理 ProviderSwitchNeeded / SemaphoreQueueFullError / SemaphoreTimeoutError
 * 3. 管理 excludeTargets 跨迭代累积
 *
 * 与旧版区别：
 * - 使用 PipelineContext 代替 FailoverContext
 * - 使用 ProxyPipeline.execute() 代替手动编排各步骤
 * - 内置 hook 负责日志/溢出/patches 等，此文件只关注 failover 循环控制
 */
import { randomUUID } from "crypto";
import type { FastifyReply } from "fastify";
import { getProviderById } from "../../db/index.js";
import { insertRejectedLog } from "../log-helpers.js";
import { getSetting } from "../../db/settings.js";
import { resolveMapping, filterExcluded } from "../routing/mapping-resolver.js";
import { expandOverflowTargets } from "../routing/overflow.js";
import { computeModalityRedirectTargets } from "../routing/modality-redirect.js";
import { getConfig } from "../../config/index.js";
import type { ProxyErrorFormatter } from "../proxy-core.js";
import type { FormatAdapter } from "../format/types.js";
import type { FormatRegistry } from "../format/registry.js";
import { sanitizeHeadersForLog } from "../proxy-logging.js";
import { loadEnhancementConfig } from "../routing/enhancement-config.js";
import { extractFailedToolResults } from "./proxy-handler-utils.js";
import type { FailedToolResult } from "./proxy-handler-utils.js";
import { logToolErrors } from "../tool-error-logger.js";
import type { Target, MappingReason } from "../../core/types.js";
import type { RawHeaders } from "../types.js";
import type { PipelineContext } from "../pipeline/types.js";
import { PipelineSnapshot } from "../pipeline-snapshot.js";
import type { ServiceContainer } from "../../core/container.js";
import { SERVICE_KEYS } from "../../core/container.js";
import type { RetryRuleMatcher } from "../orchestration/retry-rules.js";
import type { ProxyOrchestrator } from "../orchestration/orchestrator.js";
import type { RequestTracker } from "../../core/monitor/index.js";
import type { UsageWindowTracker } from "../routing/usage-window-tracker.js";
import type { ProxyAgentFactory } from "../transport/proxy-agent.js";
import type { PluginRegistry } from "../transform/plugin-registry.js";
import Database from "better-sqlite3";
import type { RejectParams } from "./reject-helpers.js";
import { rejectAndReply } from "./reject-helpers.js";
import { buildIterationSetup } from "./iteration-setup.js";
import { processResilienceResult } from "./resilience-processor.js";

const UPSTREAM_ERROR_STATUS = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;
const MAX_FAILOVER_ITERATIONS = 10;

// ---------- Dependencies ----------

export interface FailoverLoopDeps {
  db: Database.Database;
  container: ServiceContainer;
  orchestrator: ProxyOrchestrator;
  proxyAgentFactory?: ProxyAgentFactory;
}



// ---------- Precompute routing targets ----------

export type PrecomputeResult =
  | { ok: true; cachedTargets: Target[]; overflowIndices: Set<number>; resolveResult: NonNullable<ReturnType<typeof resolveMapping>>; pendingToolErrors: FailedToolResult[] | null }
  | { ok: false; errorCode: "no_mapping" | "unsupported_modality" | "no_allowed_model" };

export function precomputeFailoverTargets(input: {
  db: Database.Database;
  clientModel: string;
  body: Record<string, unknown>;
  precomputeSnapshot: PipelineSnapshot;
  allowedModels: string[] | undefined;
  enhancementConfig: ReturnType<typeof loadEnhancementConfig>;
}): PrecomputeResult {
  const { db, clientModel, body, precomputeSnapshot, allowedModels, enhancementConfig } = input;

  // 1. resolveMapping — 只调一次
  const resolveResult = resolveMapping(db, clientModel, { now: new Date() });
  if (!resolveResult) {
    return { ok: false, errorCode: "no_mapping" };
  }

  let allTargets = resolveResult.allTargets ?? [resolveResult.target];

  // 2. modality-redirect 层
  allTargets = computeModalityRedirectTargets(db, allTargets, clientModel, body, precomputeSnapshot);
  if (allTargets.length === 0) {
    return { ok: false, errorCode: "unsupported_modality" };
  }

  // 3. OF 层
  const targetsBeforeOF = allTargets.length;
  const ofResult = expandOverflowTargets(allTargets, db, body);
  allTargets = ofResult.targets;
  precomputeSnapshot.add({ stage: "overflow", triggered: allTargets.length > targetsBeforeOF });

  // 4. allowed_models 过滤
  let overflowIndices = ofResult.overflowIndices;
  if (allowedModels && allowedModels.length > 0) {
    const newOverflowIndices = new Set<number>();
    const filtered: Target[] = [];
    for (let i = 0; i < allTargets.length; i++) {
      if (allowedModels.includes(allTargets[i].backend_model)) {
        if (overflowIndices.has(i)) newOverflowIndices.add(filtered.length);
        filtered.push(allTargets[i]);
      }
    }
    allTargets = filtered;
    overflowIndices = newOverflowIndices;
    if (allTargets.length === 0) {
      return { ok: false, errorCode: "no_allowed_model" };
    }
  }

  // 5. 工具错误日志提取
  let pendingToolErrors: FailedToolResult[] | null = null;
  if (enhancementConfig.tool_error_logging_enabled) {
    const failures = extractFailedToolResults(body);
    if (failures.length > 0) {
      pendingToolErrors = failures;
    }
  }

  return { ok: true, cachedTargets: allTargets, overflowIndices, resolveResult, pendingToolErrors };
}





// ---------- Main failover loop ----------

/**
 * 执行 failover 循环。每次迭代通过 pipeline 处理请求，
 * 失败时将 target 加入 excludeTargets 并继续。
 */
export async function executeFailoverLoop(
  ctx: PipelineContext,
  errors: ProxyErrorFormatter,
  deps: FailoverLoopDeps,
  upstreamPath: string,
  adapter: FormatAdapter,
): Promise<FastifyReply> {
  const { request, reply } = ctx;
  const { db, container, orchestrator } = deps;
  const tracker = container.resolve<RequestTracker>(SERVICE_KEYS.tracker);
  const usageWindowTracker = container.resolve<UsageWindowTracker>(SERVICE_KEYS.usageWindowTracker);
  const formatRegistry = container.resolve<FormatRegistry>(SERVICE_KEYS.formatRegistry);
  const matcher = container.resolve<RetryRuleMatcher>(SERVICE_KEYS.matcher);
  const logFileWriter = container.resolve<import("../../storage/log-file-writer.js").LogFileWriter>(SERVICE_KEYS.logFileWriter);
  const pluginRegistry = container.resolve<PluginRegistry>(SERVICE_KEYS.pluginRegistry);
  const config = getConfig();
  const enhancementConfig = loadEnhancementConfig(db);

  const excludeTargets: Target[] = [];
  let rootLogId: string | null = null;
  let pendingToolErrors: FailedToolResult[] | null = null;

  const flushToolErrors = (providerId: string, model: string, reqLogId: string) => {
    if (!pendingToolErrors) return;
    logToolErrors(pendingToolErrors, {
      db, providerId, backendModel: model,
      clientAgentType: ctx.metadata.get("client_type") as string ?? "unknown",
      requestLogId: reqLogId,
      routerKeyId: request.routerKey?.id ?? null,
      sessionId: ctx.metadata.get("session_id") as string | undefined,
    });
    pendingToolErrors = null;
  };

  const clientModel = ctx.clientModel;
  const rawBody = ctx.rawBody;
  const clientApiType = ctx.apiType as "openai" | "openai-responses" | "anthropic";

  // BP-H4: 循环不变量预计算，避免每次迭代重复 JSON.stringify + sanitizeHeaders
  const cliHdrs: RawHeaders = request.headers as RawHeaders;
  const sanitizedClientHeaders = sanitizeHeadersForLog(cliHdrs as Record<string, string>);
  const precomputedClientReq = JSON.stringify({ headers: sanitizedClientHeaders, body: rawBody });

  // BP-H3: encryptionKey 用于 resolveEndpoint 解密
  const encryptionKey = getSetting(db, "encryption_key");

  // === 循环前：路由决策（resolveMapping → IR → OF 分层预计算） ===
  const precomputeSnapshot = new PipelineSnapshot();
  const precomputeResult = precomputeFailoverTargets({
    db, clientModel: ctx.clientModel, body: ctx.body,
    precomputeSnapshot,
    allowedModels: request.routerKey?.allowed_models ?? undefined,
    enhancementConfig,
  });

  // resolveMapping 返回 null 时，需要用占位 snapshot 做错误日志
  const rejectSnapshot = new PipelineSnapshot();

  /** 构建 RejectParams，消除 4 处重复构造 */
  const buildRejectCtx = (logId: string, snapshot: PipelineSnapshot, overrides?: Partial<RejectParams>): RejectParams => ({
    db, logId, apiType: ctx.apiType, model: clientModel,
    startTime: Date.now(),
    isStream: (ctx.body as Record<string, unknown>).stream === true,
    routerKeyId: request.routerKey?.id ?? null,
    originalBody: rawBody, clientHeaders: cliHdrs,
    isFailover: false, originalRequestId: null,
    sessionId: ctx.metadata.get("session_id") as string | undefined,
    pipelineSnapshot: snapshot.toJSON(),
    matcher, logFileWriter,
    ...overrides,
  });

  if (!precomputeResult.ok) {
    if (precomputeResult.errorCode === "no_mapping") {
      return rejectAndReply(reply, buildRejectCtx(randomUUID(), rejectSnapshot), errors.modelNotFound(clientModel), `No mapping found for model '${clientModel}'`);
    }
    if (precomputeResult.errorCode === "unsupported_modality") {
      return rejectAndReply(reply, buildRejectCtx(randomUUID(), precomputeSnapshot), errors.unsupportedModality(),
        `No eligible target: request modalities not supported by any available model`);
    }
    return rejectAndReply(reply, buildRejectCtx(randomUUID(), precomputeSnapshot), errors.modelNotAllowed(clientModel),
      `No allowed model available for '${clientModel}'`);
  }

  const { cachedTargets, overflowIndices, resolveResult } = precomputeResult;
  const concurrencyOverride = resolveResult.concurrency_override;
  pendingToolErrors = precomputeResult.pendingToolErrors;
  if (pendingToolErrors) {
    request.log.info({ failures: pendingToolErrors.length, sessionId: ctx.metadata.get("session_id") }, "Tool error results detected");
  }

  // === while(true)：纯执行循环 ===
  let failoverIteration = 0;
  let lastFailoverTrigger: string | null = null;

  while (true) {
  // 请求被 kill 后 reply 已销毁，直接退出避免浪费 failover 迭代
    if (reply.raw.destroyed) return reply;
    if (++failoverIteration > MAX_FAILOVER_ITERATIONS) {
      return reply.code(HTTP_SERVICE_UNAVAILABLE).send({
        error: { message: `Max failover iterations (${MAX_FAILOVER_ITERATIONS}) exceeded`, type: "server_error", code: "failover_limit_exceeded" },
      });
    }
    const startTime = Date.now();
    const logId = randomUUID();
    if (rootLogId === null) rootLogId = logId;
    const isFailoverIteration = rootLogId !== logId;
    const routerKeyId = request.routerKey?.id ?? null;

    // 浅拷贝：后续操作只修改顶层属性（model），嵌套对象不被修改
    const currentBody = { ...ctx.body };
    const isStream = currentBody.stream === true;
    const iterationSnapshot = new PipelineSnapshot(precomputeSnapshot.getStages());

    const rCtx: RejectParams = buildRejectCtx(logId, iterationSnapshot, {
      startTime,
      isFailover: isFailoverIteration,
      originalRequestId: isFailoverIteration ? rootLogId : null,
    });

    // --- 选第一个非 excluded target ---
    const filtered = filterExcluded(cachedTargets, excludeTargets);
    if (filtered.length === 0) {
      return rejectAndReply(reply, rCtx, errors.upstreamConnectionFailed(),
        `All failover targets exhausted (${excludeTargets.length} attempted)`);
    }

    const resolved = filtered[0];
    const isFailover = cachedTargets.length > 1;

    // effectiveMappingReason: 首次迭代用 resolveResult.reason，溢出时覆盖
    let effectiveMappingReason: MappingReason = isFailoverIteration ? "failover_retry" : resolveResult.mappingReason;
    // 只有当前 target 是 overflow 扩展产生的才标记
    const resolvedIdx = cachedTargets.findIndex(t => t.provider_id === resolved.provider_id && t.backend_model === resolved.backend_model);
    if (overflowIndices.has(resolvedIdx)) effectiveMappingReason = "overflow_redirect";

    // 将 mappingReason 注入 rCtx，使后续 rejectAndReply 能写入诊断字段
    rCtx.mappingReason = effectiveMappingReason;

    const provider = getProviderById(db, resolved.provider_id);
    if (!provider || !provider.is_active) {
      lastFailoverTrigger = "provider_unavailable";
      insertRejectedLog({
        db, logId, apiType: clientApiType as "openai" | "openai-responses" | "anthropic",
        model: clientModel, statusCode: 503,
        errorMessage: `Provider '${resolved.provider_id}' unavailable`,
        startTime, isStream, routerKeyId,
        originalBody: rawBody, clientHeaders: cliHdrs,
        providerId: resolved.provider_id, originalModel: null,
        isFailover: isFailoverIteration, originalRequestId: isFailoverIteration ? rootLogId : null,
        sessionId: ctx.metadata.get("session_id") as string | undefined,
        pipelineSnapshot: iterationSnapshot.toJSON(),
        matcher, logFileWriter,
        mapping_reason: rCtx.mappingReason ?? null,
        backend_model: resolved.backend_model,
      });
      excludeTargets.push(resolved);
      continue;
    }

    // --- resolveEndpoint + setup (异常时 failover 到下一个 target) ---
    try {
      const setupResult = buildIterationSetup({
        formatRegistry, pluginRegistry, currentBody,
        ctxApiType: ctx.apiType, clientApiType,
        provider, resolved, upstreamPath, encryptionKey,
        cliHdrs, reply, startTime, logId, clientModel,
        precomputedClientReq, enhancementConfig,
        tracker, matcher, request, adapter,
        proxyAgentFactory: deps.proxyAgentFactory,
        iterationSnapshot, effectiveMappingReason, isStream, isFailover,
        flushToolErrors, errors, rCtx,
      });
      if (!setupResult.ok) return setupResult.reply;

      const resultAction = await processResilienceResult({
        orchestrator, request, reply, clientApiType,
        resolved, provider, clientModel, isStream, logId,
        sessionId: ctx.metadata.get("session_id") as string | undefined,
        clientReq: precomputedClientReq, upstreamReqBase: setupResult.upstreamReqBase,
        concurrencyOverride, effectiveMappingReason,
        retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
        isFailover, matcher, transportFn: setupResult.transportFn,
        db, tracker, usageWindowTracker, errors, rCtx,
        pipelineSnapshot: setupResult.pipelineSnapshot,
        flushCurrentErrors: setupResult.flushCurrentErrors,
        adapter, logFileWriter, resolvedEndpoint: setupResult.resolvedEndpoint,
        rootLogId: rootLogId!, isFailoverIteration,
        ctx, routerKeyId, lastFailoverTrigger, startTime,
      });

      if (resultAction.action === "continue") {
        lastFailoverTrigger = resultAction.trigger;
        excludeTargets.push(resolved);
        continue;
      }
      return resultAction.reply;
    } catch (setupErr: unknown) {
      // resolveEndpoint 或 setup 阶段异常 → failover 到下一个 target
      const errMsg = setupErr instanceof Error ? setupErr.message : JSON.stringify(setupErr);
      request.log.error({ logId, error: errMsg, providerId: resolved.provider_id, action: "endpoint_setup_failed" }, "resolveEndpoint/setup failed");
      insertRejectedLog({
        db, logId, apiType: clientApiType as "openai" | "openai-responses" | "anthropic",
        model: clientModel, statusCode: UPSTREAM_ERROR_STATUS,
        errorMessage: `Endpoint setup failed: ${errMsg}`,
        startTime, isStream, routerKeyId,
        originalBody: rawBody, clientHeaders: cliHdrs,
        providerId: resolved.provider_id, originalModel: null,
        isFailover: isFailoverIteration, originalRequestId: isFailoverIteration ? rootLogId : null,
        sessionId: ctx.metadata.get("session_id") as string | undefined,
        pipelineSnapshot: iterationSnapshot.toJSON(),
        matcher, logFileWriter,
        mapping_reason: rCtx.mappingReason ?? null,
        backend_model: resolved.backend_model,
      });
      excludeTargets.push(resolved);
      continue;
    }
  }
}


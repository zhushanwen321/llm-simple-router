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
import { ProviderSwitchNeeded } from "../../core/errors.js";
import { SemaphoreQueueFullError, SemaphoreTimeoutError } from "../../core/errors.js";
import { getProviderById, updateLogClientStatus, insertRequestLog, updateLogStreamContent } from "../../db/index.js";
import { logUpstreamError, extractErrorInfo } from "../../db/upstream-error-logs.js";
import { getSetting } from "../../db/settings.js";
import { decrypt } from "../../utils/crypto.js";
import { resolveMapping, filterExcluded } from "../routing/mapping-resolver.js";
import { expandOverflowTargets } from "../routing/overflow.js";
import { computeModalityRedirectTargets } from "../routing/modality-redirect.js";
import { getConfig } from "../../config/index.js";
import type { ProxyErrorFormatter } from "../proxy-core.js";
import type { FormatAdapter } from "../format/types.js";
import type { FormatRegistry } from "../format/registry.js";
import { insertRejectedLog } from "../log-helpers.js";
import { logResilienceResult, collectTransportMetrics, sanitizeHeadersForLog } from "../proxy-logging.js";
import { buildUpstreamHeaders, buildUpstreamUrl } from "../proxy-core.js";
import { getModelStreamTimeout } from "../../db/providers.js";
import { buildTransportFn } from "../transport/transport-fn.js";
import { parseModels } from "../../config/model-context.js";
import { applyProviderPatches } from "../patch/index.js";
import { loadEnhancementConfig } from "../routing/enhancement-config.js";
import { extractFailedToolResults, getTransportStatusCode, serializeBlocksForStorage } from "./proxy-handler-utils.js";
import type { FailedToolResult } from "./proxy-handler-utils.js";
import { logToolErrors } from "../tool-error-logger.js";
import type { Target, MappingReason } from "../../core/types.js";
import type { RawHeaders } from "../types.js";
import type { PipelineContext } from "../pipeline/types.js";
import { PipelineAbort } from "../pipeline/types.js";
import { PipelineSnapshot } from "../pipeline-snapshot.js";
import type { ServiceContainer } from "../../core/container.js";
import { SERVICE_KEYS } from "../../core/container.js";
import type { RetryRuleMatcher } from "../orchestration/retry-rules.js";
import type { ProxyOrchestrator } from "../orchestration/orchestrator.js";
import type { RequestTracker } from "../../core/monitor/index.js";
import type { UsageWindowTracker } from "../routing/usage-window-tracker.js";
import type { ProxyAgentFactory } from "../transport/proxy-agent.js";
import type { PluginRegistry } from "../transform/plugin-registry.js";
import type { ResponseTransformContext } from "../transform/plugin-types.js";
import type { ApiType } from "../transform/types.js";
import Database from "better-sqlite3";

const HTTP_ERROR_THRESHOLD = 400;
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

// ---------- Rejected log helper ----------

interface RejectParams {
  db: Database.Database;
  logId: string;
  apiType: string;
  model: string;
  startTime: number;
  isStream: boolean;
  routerKeyId: string | null;
  originalBody: Record<string, unknown>;
  clientHeaders: RawHeaders;
  isFailover: boolean;
  originalRequestId: string | null;
  sessionId: string | undefined;
  pipelineSnapshot?: string;
  matcher?: RetryRuleMatcher;
  logFileWriter?: import("../../storage/log-file-writer.js").LogFileWriter | null;
  mappingReason?: string | null;
}

// --- Plugin 调整 body 和 headers ---
function applyPluginAdjustments(
  pluginRegistry: import("../transform/plugin-registry.js").PluginRegistry | undefined,
  body: Record<string, unknown>,
  clientApiType: string,
  provider: { id: string; name: string; base_url: string; api_type: string },
): { headers: Record<string, string> } {
  if (!pluginRegistry) return { headers: {} };
  const pluginCtx: import("../transform/plugin-types.js").RequestTransformContext = {
    body,
    headers: {},
    sourceApiType: clientApiType as ApiType,
    targetApiType: provider.api_type as ApiType,
    provider: { id: provider.id, name: provider.name, base_url: provider.base_url, api_type: provider.api_type },
  };
  pluginRegistry.applyBeforeRequest(pluginCtx);
  pluginRegistry.applyAfterRequest(pluginCtx);
  return { headers: pluginCtx.headers };
}

function rejectAndReply(
  reply: FastifyReply,
  params: RejectParams,
  error: { statusCode: number; body: unknown },
  errorMessage: string,
  providerId?: string,
  afterLog?: () => void,
): FastifyReply {
  insertRejectedLog({
    db: params.db, logId: params.logId, apiType: params.apiType as "openai" | "openai-responses" | "anthropic", model: params.model,
    statusCode: error.statusCode, errorMessage, startTime: params.startTime,
    isStream: params.isStream, routerKeyId: params.routerKeyId,
    originalBody: params.originalBody, clientHeaders: params.clientHeaders,
    providerId: providerId ?? null, originalModel: null,
    isFailover: params.isFailover, originalRequestId: params.originalRequestId,
    sessionId: params.sessionId, pipelineSnapshot: params.pipelineSnapshot,
    matcher: params.matcher, logFileWriter: params.logFileWriter,
    mapping_reason: params.mappingReason ?? null,
  });
  try { afterLog?.(); } catch { /* tool error log 写入失败不影响响应 */ } // eslint-disable-line taste/no-silent-catch
  return reply.code(error.statusCode).send(error.body);
}

// ---------- Main failover loop ----------

/**
 * 执行 failover 循环。每次迭代通过 pipeline 处理请求，
 * 失败时将 target 加入 excludeTargets 并继续。
 */
// eslint-disable-next-line max-lines-per-function
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

  // BP-H3: 请求级 API Key 缓存，避免同一 provider 重复解密
  const decryptedApiKeys = new Map<string, string>();
  const encryptionKey = getSetting(db, "encryption_key");

  // === 循环前：路由决策（resolveMapping → IR → OF 分层预计算） ===

  const precomputeSnapshot = new PipelineSnapshot();

  // 1. resolveMapping — 只调一次，不传 excludeTargets（exclude 在循环内处理）
  const resolveResult = resolveMapping(db, clientModel, { now: new Date() });

  // resolveMapping 返回 null 时，需要用占位 snapshot 做错误日志
  const rejectSnapshot = new PipelineSnapshot();

  if (!resolveResult) {
    const logId = randomUUID();
    const startTime = Date.now();
    const isStream = (ctx.body as Record<string, unknown>).stream === true;
    const rCtx: RejectParams = {
      db, logId, apiType: ctx.apiType, model: clientModel,
      startTime, isStream, routerKeyId: request.routerKey?.id ?? null, originalBody: rawBody, clientHeaders: cliHdrs,
      isFailover: false, originalRequestId: null,
      sessionId: ctx.metadata.get("session_id") as string | undefined,
      pipelineSnapshot: rejectSnapshot.toJSON(),
      matcher, logFileWriter,
    };
    return rejectAndReply(reply, rCtx, errors.modelNotFound(clientModel), `No mapping found for model '${clientModel}'`);
  }

  let allTargets = resolveResult.allTargets ?? [resolveResult.target];
  const concurrencyOverride = resolveResult.concurrency_override;

  // 2. modality-redirect 层：模态重定向 → 可能 prepend fallback target
  allTargets = computeModalityRedirectTargets(db, allTargets, clientModel, ctx.body, precomputeSnapshot);

  // 2a. modality-redirect 层返回空列表 → 提前报错（无 target 支持请求模态）
  if (allTargets.length === 0) {
    const logId = randomUUID();
    const startTime = Date.now();
    const isStream = (ctx.body as Record<string, unknown>).stream === true;
    const rCtx: RejectParams = {
      db, logId, apiType: ctx.apiType, model: clientModel,
      startTime, isStream, routerKeyId: request.routerKey?.id ?? null,
      originalBody: rawBody, clientHeaders: cliHdrs,
      isFailover: false, originalRequestId: null,
      sessionId: ctx.metadata.get("session_id") as string | undefined,
      pipelineSnapshot: precomputeSnapshot.toJSON(),
      matcher, logFileWriter,
    };
    return rejectAndReply(reply, rCtx, errors.unsupportedModality(),
      `No eligible target: request modalities not supported by any available model`);
  }

  // 3. OF 层：为每个 target 预计算 overflow
  const targetsBeforeOF = allTargets.length;
  const ofResult = expandOverflowTargets(allTargets, db, ctx.body);
  allTargets = ofResult.targets;
  precomputeSnapshot.add({ stage: "overflow", triggered: allTargets.length > targetsBeforeOF });

  // 4. allowed_models 过滤：MRL fallback 和 overflow 扩展的 target 也必须受约束
  const allowedModels = request.routerKey?.allowed_models;
  let overflowIndices = ofResult.overflowIndices;
  if (allowedModels && allowedModels.length > 0) {
    // 重建 overflowIndices：filter 会改变 index，需同步更新
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
      const logId = randomUUID();
      const startTime = Date.now();
      const isStream = (ctx.body as Record<string, unknown>).stream === true;
      const rCtx: RejectParams = {
        db, logId, apiType: ctx.apiType, model: clientModel,
        startTime, isStream, routerKeyId: request.routerKey?.id ?? null, originalBody: rawBody, clientHeaders: cliHdrs,
        isFailover: false, originalRequestId: null,
        sessionId: ctx.metadata.get("session_id") as string | undefined,
        pipelineSnapshot: precomputeSnapshot.toJSON(),
        matcher, logFileWriter,
      };
      return rejectAndReply(reply, rCtx, errors.modelNotAllowed(clientModel),
        `No allowed model available for '${clientModel}'`);
    }
  }

  // 预计算完成，缓存到循环外
  const cachedTargets = allTargets;

  // 工具错误日志提取（循环外一次性执行）
  if (enhancementConfig.tool_error_logging_enabled) {
    const failures = extractFailedToolResults(ctx.body);
    if (failures.length > 0) {
      request.log.info({ failures: failures.length, sessionId: ctx.metadata.get("session_id") }, "Tool error results detected");
      pendingToolErrors = failures;
    }
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
    let currentBody = { ...ctx.body };
    const isStream = currentBody.stream === true;
    const iterationSnapshot = new PipelineSnapshot(precomputeSnapshot.getStages());

    const rCtx: RejectParams = {
      db, logId, apiType: ctx.apiType, model: clientModel,
      startTime, isStream, routerKeyId, originalBody: rawBody, clientHeaders: cliHdrs,
      isFailover: isFailoverIteration, originalRequestId: isFailoverIteration ? rootLogId : null,
      sessionId: ctx.metadata.get("session_id") as string | undefined,
      pipelineSnapshot: iterationSnapshot.toJSON(),
      matcher, logFileWriter,
    };

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
      });
      excludeTargets.push(resolved);
      continue;
    }


    // 当前迭代的工具错误刷新闭包（统一 6 处调用）
    const flushCurrentErrors = () => flushToolErrors(provider.id, resolved.backend_model ?? clientModel, logId);

    // --- 格式转换 + upstreamPath 决策 ---
    const resolvedPath = resolveUpstreamPath(formatRegistry, currentBody, ctx.apiType as ApiType, provider.api_type as ApiType, provider.upstream_path ?? undefined, upstreamPath, resolved.backend_model ?? clientModel ?? "");
    currentBody = resolvedPath.body;
    const effectiveApiType = resolvedPath.effectiveApiType;
    const effectiveUpstreamPath = resolvedPath.effectiveUpstreamPath;
    const needsTransform = resolvedPath.needsTransform;

    // --- routing ---
    currentBody = { ...currentBody, model: resolved.backend_model };
    iterationSnapshot.add({ stage: "routing", client_model: clientModel, backend_model: resolved.backend_model, provider_id: resolved.provider_id, strategy: cachedTargets.length > 1 ? "failover" : "scheduled", mapping_reason: effectiveMappingReason });

    // --- Plugin 调整 body 和 headers ---
    const pluginResult = applyPluginAdjustments(pluginRegistry, currentBody, clientApiType, provider);
    const injectedHeaders = pluginResult.headers;

    // --- Provider patches ---
    const providerModels = parseModels(provider.models || "[]");
    const { body: patchedBody, meta: patchMeta } = applyProviderPatches(currentBody, {
      base_url: provider.base_url,
      api_type: provider.api_type,
      models: providerModels,
    });
    iterationSnapshot.add({ stage: "provider_patch", types: patchMeta.types });

    // --- API key ---
    if (!encryptionKey) {
      return rejectAndReply(reply, rCtx, errors.providerUnavailable(),
        `Encryption key not configured`, provider.id,
        flushCurrentErrors);
    }
    let apiKey = decryptedApiKeys.get(provider.id);
    if (!apiKey) {
      apiKey = decrypt(provider.api_key, encryptionKey);
      decryptedApiKeys.set(provider.id, apiKey);
    }

    // --- beforeSendProxy + Build logging data ---
    adapter.beforeSendProxy?.(patchedBody, isStream);
    const reqBodyStr = JSON.stringify(patchedBody);
    const clientReq = precomputedClientReq;
    const upstreamReqBase = JSON.stringify({
      url: buildUpstreamUrl(provider.base_url, effectiveUpstreamPath),
      headers: sanitizeHeadersForLog(buildUpstreamHeaders(cliHdrs, apiKey, Buffer.byteLength(reqBodyStr), effectiveApiType)),
      body: reqBodyStr,
    });

    // --- Stream transforms ---
    // source=上游格式, target=客户端格式 — 流从上游流向客户端需要反向转换
    const formatTransform = needsTransform ? formatRegistry.createStreamTransform(provider.api_type, ctx.apiType, resolved.backend_model) : undefined;
    if (formatTransform) {
      formatTransform.on("warning", (err) => request.log.warn({ err, logId }, "formatTransform warning"));
    }

    const responseTransform = needsTransform ? (bodyStr: string): string => {
      try {
        const parsed = JSON.parse(bodyStr) as Record<string, unknown>;
        if (parsed.type === "error" || parsed.error) {
          return formatRegistry.transformError(parsed, provider.api_type, ctx.apiType);
        }
        let transformed = formatRegistry.transformResponse(parsed, provider.api_type, ctx.apiType);
        if (pluginRegistry && !isStream) {
          try {
            const respCtx: ResponseTransformContext = {
              response: transformed,
              sourceApiType: provider.api_type as "openai" | "openai-responses" | "anthropic",
              targetApiType: clientApiType,
              provider: { id: provider.id, name: provider.name, base_url: provider.base_url, api_type: provider.api_type },
            };
            pluginRegistry.applyBeforeResponse(respCtx);
            pluginRegistry.applyAfterResponse(respCtx);
            transformed = respCtx.response;
          } catch { /* response hooks best-effort */ } // eslint-disable-line taste/no-silent-catch
        }
        return JSON.stringify(transformed);
      } catch (err) {
        request.log.error({ err }, "responseTransform failed");
        return bodyStr;
      }
    } : undefined;

    // --- Build transport function ---
    const streamLoopEnabled = enhancementConfig.stream_loop_enabled;
    const transportFn = buildTransportFn({
      provider, apiKey, body: patchedBody, cliHdrs, reply, upstreamPath: effectiveUpstreamPath, apiType: effectiveApiType,
      isStream, startTime, logId, effectiveModel: clientModel,
      streamTimeoutMs: getModelStreamTimeout(provider, resolved.backend_model),
      tracker, matcher, request,
      streamLoopEnabled, formatTransform, responseTransform, injectedHeaders,
      timeoutContext: { modelId: resolved.backend_model, providerId: provider.id },
      proxyAgentFactory: deps.proxyAgentFactory,
    });

    const pipelineSnapshot = iterationSnapshot.toJSON();

    // --- Execute through orchestrator ---
    try {
      const resilienceResult = await orchestrator.handle(
        request, reply, clientApiType,
        { resolved, provider, clientModel, isStream, trackerId: logId, sessionId: ctx.metadata.get("session_id") as string | undefined, clientRequest: clientReq, upstreamRequest: upstreamReqBase, concurrencyOverride, mappingReason: effectiveMappingReason },
        { retryBaseDelayMs: config.RETRY_BASE_DELAY_MS, isFailover, ruleMatcher: matcher, transportFn },
      );

      // 日志记录
      const lastLogId = logResilienceResult(
        db,
        {
          apiType: clientApiType,
          model: clientModel, providerId: provider.id, isStream,
          clientReq, upstreamReqBase, logId, routerKeyId, originalModel: null, sessionId: ctx.metadata.get("session_id") as string | undefined,
          failover: { isFailoverIteration, rootLogId: rootLogId! },
          pipelineSnapshot,
          matcher, logFileWriter,
          resilienceAction: resilienceResult.finalDecision?.action,
          resilienceReason: resilienceResult.finalDecision?.action === "abort"
            ? (resilienceResult.finalDecision as { action: "abort"; reason: string }).reason
            : null,
          mappingReason: effectiveMappingReason,
          failoverTrigger: lastFailoverTrigger,
        },
        resilienceResult.attempts, resilienceResult.result, startTime,
      );
      collectTransportMetrics(db, clientApiType, resilienceResult.result, isStream, lastLogId, provider.id, resolved.backend_model, request, routerKeyId, getTransportStatusCode(resilienceResult.result), ctx.metadata.get("client_type") as string | undefined, ctx.metadata.get("session_id") as string | undefined, tracker, ctx.metadata);

      // flush tool errors
      flushToolErrors(provider.id, resolved.backend_model ?? clientModel, lastLogId);

      // Stream timeout
      if (resilienceResult.result.kind === "stream_abort" && resilienceResult.result.timeoutContext) {
        const { modelId, providerId } = resilienceResult.result.timeoutContext;
        const msg = `Stream timeout: no data received for ${resilienceResult.result.timeoutMs}ms (model: ${modelId}, provider: ${providerId})`;
        const errBody = clientApiType === "anthropic"
          ? { type: "error", error: { type: "api_error", message: msg } }
          : { error: { message: msg, type: "server_error", code: "stream_timeout" } };
        try { reply.raw.write(`data: ${JSON.stringify(errBody)}\n\n`); } catch { /* client disconnected */ } // eslint-disable-line taste/no-silent-catch
        try { reply.raw.end(); } catch { /* client disconnected */ } // eslint-disable-line taste/no-silent-catch
      }

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
          lastFailoverTrigger = tr.kind === "throw" ? "throw" : `status_${("statusCode" in tr ? tr.statusCode : 0)}`;
          excludeTargets.push(resolved);
          continue;
        }
      }

      // 发送响应（orchestrator 对部分场景不发送）
      if (!reply.raw.headersSent) {
        if (tr.kind === "success") {
          return reply.code(tr.statusCode).send(tr.body);
        }
        if (tr.kind === "stream_error") {
          // stream_error + headersSent 已在 orchestrator.sendResponse 中处理
          // 此处为 !headersSent 分支：格式化错误体并发送
          const trStatus = getTransportStatusCode(tr);
          if (trStatus !== null) updateLogClientStatus(db, lastLogId, trStatus);
          const formattedBody = adapter.formatError(
            'body' in tr ? tr.body : "stream error",
          ) ?? { error: { message: "stream error", type: "server_error" } };
          reply.header("content-type", "application/json");
          return reply.code(tr.statusCode).send(formattedBody);
        }
        if (tr.kind === "throw" || (tr.kind === "error" && tr.statusCode >= HTTP_ERROR_THRESHOLD)) {
          const err = errors.upstreamConnectionFailed();
          updateLogClientStatus(db, lastLogId, err.statusCode);
          return reply.code(err.statusCode).send(err.body);
        }
        // 未知 TransportResult kind 的兜底响应
        return reply.code(UPSTREAM_ERROR_STATUS).send(
          adapter.formatError("Unhandled transport result") ?? { error: { message: "Unhandled transport result", type: "server_error" } },
        );
      }

      return reply;
    } catch (e: unknown) {
      if (e instanceof PipelineAbort) {
        return reply.code(e.statusCode).send(e.body);
      }

      if (e instanceof ProviderSwitchNeeded) {
        if (reply.raw.headersSent) return reply;
        // 补写失败日志
        if (e.attempts && e.attempts.length > 0) {
          const fakeResult = e.lastResult ?? { kind: "throw" as const, error: new Error("provider switch") };
          logResilienceResult(
            db,
            {
              apiType: clientApiType,
              model: clientModel, providerId: provider.id, isStream,
              clientReq, upstreamReqBase, logId, routerKeyId, originalModel: null, sessionId: ctx.metadata.get("session_id") as string | undefined,
              failover: { isFailoverIteration, rootLogId: rootLogId! },
              pipelineSnapshot,
              matcher, logFileWriter,
              resilienceAction: "failover",
              resilienceReason: "provider_switch_needed",
              mappingReason: effectiveMappingReason,
              failoverTrigger: e.constructor.name,
            },
            e.attempts, fakeResult, startTime,
          );
        }
        flushCurrentErrors();
        lastFailoverTrigger = e.constructor.name;
        excludeTargets.push(resolved);
        continue;
      }

      if (e instanceof SemaphoreQueueFullError) {
        return rejectAndReply(reply, rCtx, errors.concurrencyQueueFull(provider.id),
          `Concurrency queue full for provider '${provider.id}'`, provider.id,
          flushCurrentErrors);
      }
      if (e instanceof SemaphoreTimeoutError) {
        return rejectAndReply(reply, rCtx, errors.concurrencyTimeout(provider.id, (e as SemaphoreTimeoutError).timeoutMs),
          `Concurrency wait timeout for provider '${provider.id}' (${(e as SemaphoreTimeoutError).timeoutMs}ms)`, provider.id,
          flushCurrentErrors);
      }

      // 请求被主动 kill（abort + reply destroy），直接退出不写日志
      if (e instanceof Error && e.name === "AbortError") {
        return reply;
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
      }, (matcher || logFileWriter) ? {
        matcher, logFileWriter, responseBody: null,
      } : undefined);
      flushCurrentErrors();
      const err = errors.upstreamConnectionFailed();
      return reply.code(err.statusCode).send(err.body);
    }
  }
}

// --- 格式转换 + upstreamPath 决策 ---
function resolveUpstreamPath(
  formatRegistry: import("../format/registry.js").FormatRegistry,
  body: Record<string, unknown>,
  clientApiType: ApiType,
  providerApiType: ApiType,
  providerUpstreamPath: string | undefined,
  defaultUpstreamPath: string,
  backendModel: string,
): { body: Record<string, unknown>; effectiveApiType: ApiType; effectiveUpstreamPath: string; needsTransform: boolean } {
  const needsTransform = formatRegistry.needsTransform(clientApiType, providerApiType);
  let effectiveApiType: ApiType = clientApiType;
  let effectiveUpstreamPath = defaultUpstreamPath;

  if (needsTransform) {
    const transformed = formatRegistry.transformRequest(body, clientApiType, providerApiType, backendModel);
    body = transformed.body as Record<string, unknown>;
    effectiveUpstreamPath = transformed.upstreamPath;
    effectiveApiType = providerApiType;
  }

  if (providerUpstreamPath) {
    effectiveUpstreamPath = providerUpstreamPath;
  }

  return { body, effectiveApiType, effectiveUpstreamPath, needsTransform };
}

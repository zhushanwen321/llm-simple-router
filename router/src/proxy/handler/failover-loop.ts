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
import { SemaphoreQueueFullError, SemaphoreTimeoutError } from "@llm-router/core";
import { getProviderById, updateLogClientStatus, insertRequestLog, updateLogStreamContent } from "../../db/index.js";
import { getSetting } from "../../db/settings.js";
import { decrypt } from "../../utils/crypto.js";
import { resolveMapping } from "../routing/mapping-resolver.js";
import { applyOverflowRedirect } from "../routing/overflow.js";
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
import { extractFailedToolResults, getTransportStatusCode, detectClientAgentType, serializeBlocksForStorage } from "./proxy-handler-utils.js";
import type { FailedToolResult } from "./proxy-handler-utils.js";
import { logToolErrors } from "../tool-error-logger.js";
import type { Target } from "../../core/types.js";
import type { RawHeaders } from "../types.js";
import type { PipelineContext } from "../pipeline/types.js";
import { PipelineAbort } from "../pipeline/types.js";
import { PipelineSnapshot } from "../pipeline-snapshot.js";
import type { ServiceContainer } from "../../core/container.js";
import { SERVICE_KEYS } from "../../core/container.js";
import type { RetryRuleMatcher } from "../orchestration/retry-rules.js";
import type { ProxyOrchestrator } from "../orchestration/orchestrator.js";
import type { RequestTracker } from "@llm-router/core/monitor";
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
  let toolErrorsLogged = false;
  let pendingToolErrors: FailedToolResult[] | null = null;

  const flushToolErrors = (providerId: string, model: string, reqLogId: string) => {
    if (!pendingToolErrors) return;
    logToolErrors(pendingToolErrors, {
      db, providerId, backendModel: model,
      clientAgentType: detectClientAgentType(request.headers as RawHeaders),
      requestLogId: reqLogId,
      routerKeyId: request.routerKey?.id ?? null,
      sessionId: ctx.sessionId,
    });
    pendingToolErrors = null;
  };

  const clientModel = ctx.clientModel;
  const rawBody = ctx.rawBody;
  const clientApiType = ctx.apiType as "openai" | "openai-responses" | "anthropic";
  let failoverIteration = 0;

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

    // 每次迭代从 pipelineBody 重新开始
    let currentBody = structuredClone(ctx.body);
    const isStream = currentBody.stream === true;
    const cliHdrs: RawHeaders = request.headers as RawHeaders;
    const iterationSnapshot = new PipelineSnapshot();

    const rCtx: RejectParams = {
      db, logId, apiType: ctx.apiType, model: clientModel,
      startTime, isStream, routerKeyId, originalBody: rawBody, clientHeaders: cliHdrs,
      isFailover: isFailoverIteration, originalRequestId: isFailoverIteration ? rootLogId : null,
      sessionId: ctx.sessionId,
      pipelineSnapshot: iterationSnapshot.toJSON(),
      matcher, logFileWriter,
    };

    // --- Route ---
    const resolveResult = resolveMapping(db, clientModel, { now: new Date(), excludeTargets });
    request.log.debug({ logId, model: clientModel, apiType: ctx.apiType, isStream, action: "resolve_mapping", resolved: !!resolveResult });

    if (!resolveResult) {
      if (excludeTargets.length > 0) {
        return rejectAndReply(reply, rCtx, errors.upstreamConnectionFailed(), `All failover targets exhausted (${excludeTargets.length} attempted)`);
      }
      return rejectAndReply(reply, rCtx, errors.modelNotFound(clientModel), `No mapping found for model '${clientModel}'`);
    }

    const concurrencyOverride = resolveResult.concurrency_override;
    let resolved = resolveResult.target;
    const isFailover = resolveResult.targetCount > 1;

    // allowed_models 检查 — 仅首次迭代
    if (excludeTargets.length === 0) {
      const allowedModels = (request.routerKey as { allowed_models?: string } | undefined)?.allowed_models;
      if (allowedModels) {
        try {
          const models: string[] = JSON.parse(allowedModels).filter((m: string) => m.trim() !== "");
          if (models.length > 0 && !models.includes(resolved.backend_model)) {
            return rejectAndReply(reply, rCtx, errors.modelNotAllowed(resolved.backend_model),
              `Model '${resolved.backend_model}' not allowed`, resolved.provider_id);
          }
        } catch {
          // eslint-disable-next-line no-magic-numbers -- log truncation length
          request.log.warn({ allowedModels: allowedModels?.slice(0, 80) }, "Invalid allowed_models JSON, allowing all models");
        }
      }
    }

    let provider = getProviderById(db, resolved.provider_id);
    if (!provider || !provider.is_active) {
      return rejectAndReply(reply, rCtx, errors.providerUnavailable(),
        `Provider '${resolved.provider_id}' unavailable`, resolved.provider_id);
    }

    // 工具错误日志提取（仅首次迭代）
    if (enhancementConfig.tool_error_logging_enabled && !toolErrorsLogged) {
      toolErrorsLogged = true;
      const failures = extractFailedToolResults(ctx.body);
      if (failures.length > 0) {
        request.log.info({ failures: failures.length, sessionId: ctx.sessionId }, "Tool error results detected");
        pendingToolErrors = failures;
      }
    }

    // --- 溢出重定向 ---
    const overflowResult = applyOverflowRedirect(resolved, db, currentBody);
    if (overflowResult) {
      const overflowProvider = getProviderById(db, overflowResult.provider_id);
      if (overflowProvider && overflowProvider.is_active) {
        resolved = { ...resolved, provider_id: overflowResult.provider_id, backend_model: overflowResult.backend_model };
        provider = overflowProvider;
        currentBody = { ...currentBody, model: overflowResult.backend_model };
      }
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
    iterationSnapshot.add({ stage: "routing", client_model: clientModel, backend_model: resolved.backend_model, provider_id: resolved.provider_id, strategy: resolveResult.targetCount > 1 ? "failover" : "scheduled" });
    iterationSnapshot.add({ stage: "overflow", triggered: overflowResult != null });

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
    const encryptionKey = getSetting(db, "encryption_key");
    if (!encryptionKey) {
      return rejectAndReply(reply, rCtx, errors.providerUnavailable(),
        `Encryption key not configured`, provider.id,
        flushCurrentErrors);
    }
    const apiKey = decrypt(provider.api_key, encryptionKey);

    // --- beforeSendProxy + Build logging data ---
    adapter.beforeSendProxy?.(patchedBody, isStream);
    const reqBodyStr = JSON.stringify(patchedBody);
    const clientReq = JSON.stringify({ headers: sanitizeHeadersForLog(cliHdrs as Record<string, string>), body: rawBody });
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
        const parsed = JSON.parse(bodyStr);
        if (parsed.type === "error" || parsed.error) {
          return formatRegistry.transformError(bodyStr, provider.api_type, ctx.apiType);
        }
        let transformed = formatRegistry.transformResponse(bodyStr, provider.api_type, ctx.apiType);
        if (pluginRegistry && !isStream) {
          try {
            const respObj = JSON.parse(transformed);
            const respCtx: ResponseTransformContext = {
              response: respObj,
              sourceApiType: provider.api_type as "openai" | "openai-responses" | "anthropic",
              targetApiType: clientApiType,
              provider: { id: provider.id, name: provider.name, base_url: provider.base_url, api_type: provider.api_type },
            };
            pluginRegistry.applyBeforeResponse(respCtx);
            pluginRegistry.applyAfterResponse(respCtx);
            transformed = JSON.stringify(respCtx.response);
          } catch { /* response hooks best-effort */ } // eslint-disable-line taste/no-silent-catch
        }
        return transformed;
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
        { resolved, provider, clientModel, isStream, trackerId: logId, sessionId: ctx.sessionId, clientRequest: clientReq, upstreamRequest: upstreamReqBase, concurrencyOverride },
        { retryBaseDelayMs: config.RETRY_BASE_DELAY_MS, isFailover, ruleMatcher: matcher, transportFn },
      );

      // 日志记录
      const lastLogId = logResilienceResult(
        db,
        {
          apiType: clientApiType,
          model: clientModel, providerId: provider.id, isStream,
          clientReq, upstreamReqBase, logId, routerKeyId, originalModel: null, sessionId: ctx.sessionId,
          failover: { isFailoverIteration, rootLogId: rootLogId! },
          pipelineSnapshot,
          matcher, logFileWriter,
        },
        resilienceResult.attempts, resilienceResult.result, startTime,
      );
      collectTransportMetrics(db, clientApiType, resilienceResult.result, isStream, lastLogId, provider.id, resolved.backend_model, request, routerKeyId, getTransportStatusCode(resilienceResult.result));

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
          excludeTargets.push(resolved);
          continue;
        }
      }

      // 发送响应（orchestrator 对部分场景不发送）
      if (!reply.raw.headersSent) {
        if (tr.kind === "success") {
          return reply.code(tr.statusCode).send(tr.body);
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
              clientReq, upstreamReqBase, logId, routerKeyId, originalModel: null, sessionId: ctx.sessionId,
              failover: { isFailoverIteration, rootLogId: rootLogId! },
              pipelineSnapshot,
              matcher, logFileWriter,
            },
            e.attempts, fakeResult, startTime,
          );
        }
        flushCurrentErrors();
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
      const errMsg = e instanceof Error ? e.message : e instanceof Error ? e.message : JSON.stringify(e);
      request.log.debug({ logId, error: errMsg, action: "upstream_error" });
      insertRequestLog(db, {
        id: logId, api_type: clientApiType,
        model: clientModel, provider_id: provider.id,
        status_code: UPSTREAM_ERROR_STATUS, latency_ms: Date.now() - startTime, is_stream: isStream ? 1 : 0,
        error_message: errMsg || "Upstream connection failed", created_at: new Date().toISOString(),
        client_request: clientReq, upstream_request: upstreamReqBase,
        is_failover: isFailoverIteration ? 1 : 0, original_request_id: isFailoverIteration ? rootLogId : null,
        router_key_id: routerKeyId, original_model: null,
        session_id: ctx.sessionId,
        pipeline_snapshot: pipelineSnapshot,
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

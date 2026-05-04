import { randomUUID } from "crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import Database from "better-sqlite3";
import { HTTP_UNPROCESSABLE_ENTITY } from "../../core/constants.js";
import { getProviderById, insertRequestLog, updateLogPipelineSnapshot, updateLogStreamContent, updateLogClientStatus } from "../../db/index.js";
import { decrypt } from "../../utils/crypto.js";
import { getSetting } from "../../db/settings.js";
import { resolveMapping } from "../routing/mapping-resolver.js";
import { applyEnhancement } from "../enhancement/enhancement-handler.js";
import { SemaphoreQueueFullError, SemaphoreTimeoutError } from "llm-router-core";
import type { RequestTracker } from "llm-router-core/monitor";
import {
  logResilienceResult,
  collectTransportMetrics,
  handleIntercept,
  sanitizeHeadersForLog,
} from "../proxy-logging.js";
import { buildUpstreamHeaders, buildUpstreamUrl } from "../proxy-core.js";
import { ProviderSwitchNeeded } from "../types.js";
import type { RawHeaders } from "../types.js";
import type { Target } from "../../core/types.js";
import { insertRejectedLog } from "../log-helpers.js";
import type { RetryRuleMatcher } from "../orchestration/retry-rules.js";
import type { ProxyOrchestrator } from "../orchestration/orchestrator.js";
import type { ProxyErrorFormatter, ProxyErrorResponse } from "../proxy-core.js";
import { ToolLoopGuard } from "llm-router-core/loop-prevention";
import { buildTransportFn } from "../transport/transport-fn.js";
import { applyOverflowRedirect } from "../routing/overflow.js";
import { parseModels } from "../../config/model-context.js";
import { applyProviderPatches } from "../patch/index.js";
import { PipelineSnapshot, type StageRecord } from "../pipeline-snapshot.js";
import { maybeInjectModelInfoTag } from "../response-transform.js";
import { applyToolRoundLimit } from "../patch/tool-round-limiter.js";
import { loadEnhancementConfig } from "../routing/enhancement-config.js";
import { getTransportStatusCode, serializeBlocksForStorage, extractLastToolUse } from "./proxy-handler-utils.js";

const HTTP_ERROR_THRESHOLD = 400;
const MAX_LOG_FIELD_LENGTH = 80;
const UPSTREAM_ERROR_STATUS = 502;
const TIER2_LOOP_THRESHOLD = 2;

// ---------- Failover loop context ----------

interface FailoverContext {
  request: FastifyRequest;
  reply: FastifyReply;
  apiType: "openai" | "openai-responses" | "anthropic";
  upstreamPath: string;
  errors: ProxyErrorFormatter;
  deps: RouteHandlerDeps;
  options?: { beforeSendProxy?: (body: Record<string, unknown>, isStream: boolean) => void };
  effectiveModel: string;
  originalModel: string | null;
  pipelineBody: Record<string, unknown>;
  rawBody: Record<string, unknown>;
  baseStages: StageRecord[];
  sessionId: string | undefined;
  streamLoopEnabled: boolean;
  matcher?: RetryRuleMatcher;
  logFileWriter?: import("../../storage/log-file-writer.js").LogFileWriter | null;
}

// ---------- Helpers ----------

interface RejectParams {
  db: Database.Database;
  logId: string;
  apiType: "openai" | "openai-responses" | "anthropic";
  model: string;
  startTime: number;
  isStream: boolean;
  routerKeyId: string | null;
  originalBody: Record<string, unknown>;
  clientHeaders: RawHeaders;
  originalModel: string | null;
  isFailover: boolean;
  originalRequestId: string | null;
  sessionId: string | undefined;
  pipelineSnapshot?: string;
  matcher?: RetryRuleMatcher;
  logFileWriter?: import("../../storage/log-file-writer.js").LogFileWriter | null;
}

function rejectAndReply(
  reply: FastifyReply,
  params: RejectParams,
  error: ProxyErrorResponse,
  errorMessage: string,
  providerId?: string,
): FastifyReply {
  insertRejectedLog({
    db: params.db, logId: params.logId, apiType: params.apiType, model: params.model,
    statusCode: error.statusCode, errorMessage, startTime: params.startTime,
    isStream: params.isStream, routerKeyId: params.routerKeyId,
    originalBody: params.originalBody, clientHeaders: params.clientHeaders,
    providerId, originalModel: params.originalModel,
    isFailover: params.isFailover, originalRequestId: params.originalRequestId,
    sessionId: params.sessionId, pipelineSnapshot: params.pipelineSnapshot,
    matcher: params.matcher, logFileWriter: params.logFileWriter,
  });
  return reply.code(error.statusCode).send(error.body);
}

export interface RouteHandlerDeps {
  db: Database.Database;
  orchestrator: ProxyOrchestrator;
  container: ServiceContainer;
}

import { getConfig } from "../../config/index.js";
import type { ServiceContainer } from "../../core/container.js";
import { SERVICE_KEYS } from "../../core/container.js";
import { TransformCoordinator } from "../transform/transform-coordinator.js";

// ---------- Main entry ----------

export async function handleProxyRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  apiType: "openai" | "openai-responses" | "anthropic",
  upstreamPath: string,
  errors: ProxyErrorFormatter,
  deps: RouteHandlerDeps,
  options?: {
    beforeSendProxy?: (body: Record<string, unknown>, isStream: boolean) => void;
  },
): Promise<FastifyReply> {
  const socketErrorHandler = (err: Error) => request.log.debug({ err }, "client socket error");
  request.raw.socket.on("error", socketErrorHandler);
  reply.raw.on("close", () => {
    request.raw.socket.removeListener("error", socketErrorHandler);
  });
  const clientModel = ((request.body as Record<string, unknown>).model as string) || "unknown";
  const sessionId = (request.headers as RawHeaders)["x-claude-code-session-id"] as string | undefined;
  const enhancementConfig = loadEnhancementConfig(deps.db);

  // 解析 matcher 和 logFileWriter，传递给日志相关调用
  const matcher = deps.container.resolve<RetryRuleMatcher>(SERVICE_KEYS.matcher);
  const logFileWriter = deps.container.resolve<import("../../storage/log-file-writer.js").LogFileWriter>(SERVICE_KEYS.logFileWriter);

  // 在所有加工之前捕获原始 body
  const reqBody = request.body as Record<string, unknown> | undefined;
  const rawBody = reqBody ? JSON.parse(JSON.stringify(reqBody)) : {};
  const snapshot = new PipelineSnapshot();

  // enhancement 阶段
  const { body: enhancedBody, effectiveModel, originalModel, interceptResponse, meta: enhMeta } = applyEnhancement(
    deps.db, request.body as Record<string, unknown>, clientModel, sessionId, request.routerKey,
  );
  snapshot.add({ stage: "enhancement", router_tags_stripped: enhMeta.router_tags_stripped, directive: enhMeta.directive });

  // tool round limiter 阶段 — 检测连续工具调用轮数，超阈值时注入提示词
  let pipelineBody = enhancedBody;
  if (enhancementConfig.tool_round_limit_enabled) {
    const roundResult = applyToolRoundLimit(enhancedBody, apiType);
    if (roundResult.injected) {
      pipelineBody = roundResult.body;
      snapshot.add({ stage: "tool_round_limit", action: "inject_warning", rounds: roundResult.rounds });
      request.log.info({ sessionId, rounds: roundResult.rounds }, "Tool round limit reached, injecting warning prompt");
    }
  }

  // tool guard 阶段 — 使用 pipelineBody（可能已被 round limiter 修改）
  const sessionTracker = deps.container.resolve<import("llm-router-core/loop-prevention").SessionTracker>(SERVICE_KEYS.sessionTracker);
  if (enhancementConfig.tool_call_loop_enabled && sessionTracker && sessionId) {
    const routerKeyId = (request.routerKey as { id?: string } | undefined)?.id ?? null;
    const sessionKey = routerKeyId ? `${routerKeyId}:${sessionId}` : sessionId;
    const lastToolUse = extractLastToolUse(pipelineBody);
    if (lastToolUse) {
      const toolGuard = new ToolLoopGuard(sessionTracker, {
        enabled: true,
        minConsecutiveCount: 3,
        detectorConfig: { n: 6, windowSize: 500, repeatThreshold: 5 },
      });
      const checkResult = toolGuard.check(sessionKey, lastToolUse);
      if (checkResult.detected) {
        const loopCount = sessionTracker.getLoopCount(sessionKey);
        if (loopCount === 1) {
          // 层级 1：透明重试 — 注入中断提示词
          pipelineBody = toolGuard.injectLoopBreakPrompt(pipelineBody, apiType, lastToolUse.toolName);
          snapshot.add({ stage: "tool_guard", action: "inject_break_prompt", tool: lastToolUse.toolName });
          request.log.warn({ sessionId, toolName: lastToolUse.toolName, loopCount },
            "Tool call loop detected, injecting break prompt");
        } else if (loopCount === TIER2_LOOP_THRESHOLD) {
          // 层级 2：优雅中断
          return reply.code(HTTP_UNPROCESSABLE_ENTITY).send({
            error: {
              type: "tool_call_loop_detected",
              message: `检测到工具调用循环（连续重复调用 "${lastToolUse.toolName}"）。请求已中断。`,
              suggestion: "请回顾对话历史，停止重复调用工具，直接告知用户当前的进展和遇到的问题。",
            },
          });
        } else {
          // 层级 3：直接断开
          request.log.warn({ sessionId, toolName: lastToolUse.toolName, loopCount },
            "Tool call loop detected, hard disconnecting");
          reply.raw.destroy();
          return reply;
        }
      }
    }
  }

  if (interceptResponse) return handleIntercept(deps.db, apiType, request, reply, interceptResponse, clientModel, sessionId, snapshot.toJSON(), matcher, logFileWriter);

  return executeFailoverLoop({
    request, reply, apiType, upstreamPath, errors, deps, options,
    effectiveModel, originalModel,
    pipelineBody,
    rawBody,
    baseStages: snapshot.getStages() as StageRecord[],
    sessionId,
    streamLoopEnabled: enhancementConfig.stream_loop_enabled,
    matcher, logFileWriter,
  });
}

// ---------- Failover loop ----------

async function executeFailoverLoop(ctx: FailoverContext): Promise<FastifyReply> {
  const { request, reply, apiType, upstreamPath, errors, deps, options, effectiveModel, originalModel, pipelineBody, rawBody, baseStages, sessionId, streamLoopEnabled, matcher, logFileWriter } = ctx;
  const tracker = deps.container.resolve<RequestTracker>(SERVICE_KEYS.tracker);
  const usageWindowTracker = deps.container.resolve<import("../routing/usage-window-tracker.js").UsageWindowTracker>(SERVICE_KEYS.usageWindowTracker);
  const config = getConfig();
  const excludeTargets: Target[] = [];
  let rootLogId: string | null = null;
  // TransformCoordinator 无状态，只需创建一次
  const coordinator = new TransformCoordinator();
  while (true) {
    const startTime = Date.now();
    const logId = randomUUID();
    if (rootLogId === null) rootLogId = logId;
    const isFailoverIteration = rootLogId !== logId;
    const routerKeyId = request.routerKey?.id ?? null;

    // 每次迭代从 pipelineBody 重新开始（不修改 pipelineBody）
    let currentBody = JSON.parse(JSON.stringify(pipelineBody));
    const isStream = currentBody.stream === true;
    const cliHdrs: RawHeaders = request.headers as RawHeaders;

    // 构建 per-iteration snapshot
    const iterationSnapshot = new PipelineSnapshot(baseStages);

    const rCtx: RejectParams = {
      db: deps.db, logId, apiType, model: effectiveModel,
      startTime, isStream, routerKeyId, originalBody: rawBody, clientHeaders: cliHdrs, originalModel,
      isFailover: isFailoverIteration, originalRequestId: isFailoverIteration ? rootLogId : null, sessionId,
      pipelineSnapshot: iterationSnapshot.toJSON(),
      matcher, logFileWriter,
    };

    const resolveResult = resolveMapping(deps.db, effectiveModel, { now: new Date(), excludeTargets });
    request.log.debug({ logId, model: effectiveModel, apiType, isStream, action: "resolve_mapping", resolved: !!resolveResult });

    if (!resolveResult) {
      if (excludeTargets.length > 0) {
        return rejectAndReply(reply, { ...rCtx, isFailover: true, originalRequestId: rootLogId },
          errors.upstreamConnectionFailed(), `All failover targets exhausted (${excludeTargets.length} attempted)`);
      }
      return rejectAndReply(reply, rCtx, errors.modelNotFound(effectiveModel), `No mapping found for model '${effectiveModel}'`);
    }

    const concurrencyOverride = resolveResult.concurrency_override;
    let resolved = resolveResult.target;
    // 活跃 targets（schedule 或 base）数量 > 1 时启用 failover
    const isFailover = resolveResult.targetCount > 1;

    if (excludeTargets.length === 0) {
      const allowedModels = request.routerKey?.allowed_models;
      if (allowedModels) {
        try {
          const models: string[] = JSON.parse(allowedModels).filter((m: string) => m.trim() !== "");
          if (models.length > 0 && !models.includes(resolved.backend_model)) {
            return rejectAndReply(reply, rCtx, errors.modelNotAllowed(resolved.backend_model),
              `Model '${resolved.backend_model}' not allowed`, resolved.provider_id);
          }
        } catch { request.log.warn({ allowedModels: allowedModels?.slice(0, MAX_LOG_FIELD_LENGTH) }, "Invalid allowed_models JSON, allowing all models"); }
      }
    }

    let provider = getProviderById(deps.db, resolved.provider_id);
    if (!provider || !provider.is_active) {
      return rejectAndReply(reply, rCtx, errors.providerUnavailable(),
        `Provider '${resolved.provider_id}' unavailable`, resolved.provider_id);
    }
    // --- 溢出重定向：上下文超出时切换到更大模型（必须在 transform 之前，确保使用正确的 api_type） ---
    const overflowResult = applyOverflowRedirect(resolved, deps.db, currentBody);
    if (overflowResult) {
      const overflowProvider = getProviderById(deps.db, overflowResult.provider_id);
      if (overflowProvider && overflowProvider.is_active) {
        resolved = { ...resolved, provider_id: overflowResult.provider_id, backend_model: overflowResult.backend_model };
        provider = overflowProvider;
        currentBody = { ...currentBody, model: overflowResult.backend_model };
      }
    }

    // 格式转换：apiType 不匹配时转换请求体和路径
    const needsTransform = coordinator.needsTransform(apiType, provider.api_type);
    let effectiveApiType = apiType;
    let effectiveUpstreamPath = upstreamPath;

    if (needsTransform) {
      const transformed = coordinator.transformRequest(currentBody, apiType, provider.api_type, resolved.backend_model);
      // 用转换后的结果替换 currentBody
      currentBody = transformed.body as Record<string, unknown>;
      effectiveUpstreamPath = transformed.upstreamPath;
      effectiveApiType = provider.api_type;
    }

    // Provider 自定义 upstream_path 覆盖默认路径（例如百度千帆 /chat/completions）
    if (provider.upstream_path) {
      effectiveUpstreamPath = provider.upstream_path;
    }

    // routing — 创建新对象而非 in-place mutation
    currentBody = { ...currentBody, model: resolved.backend_model };
    iterationSnapshot.add({ stage: "routing", client_model: effectiveModel, backend_model: resolved.backend_model, provider_id: resolved.provider_id, strategy: resolveResult.targetCount > 1 ? "failover" : "scheduled" });

    // overflow redirect 已在 transform 之前完成，此处不再重复
    iterationSnapshot.add({ stage: "overflow", triggered: overflowResult != null });

    // Plugin 调整 body 和 headers（不受 needsTransform 限制，inject_headers 等同格式也需要）
    let injectedHeaders: Record<string, string> = {};
    const pluginRegistry = deps.container.resolve<import("../transform/plugin-registry.js").PluginRegistry>(SERVICE_KEYS.pluginRegistry);
    if (pluginRegistry) {
      const pluginCtx: import("../transform/plugin-types.js").RequestTransformContext = {
        body: currentBody,
        headers: {},
        sourceApiType: apiType,
        targetApiType: provider.api_type as "openai" | "openai-responses" | "anthropic",
        provider: { id: provider.id, name: provider.name, base_url: provider.base_url, api_type: provider.api_type },
      };
      pluginRegistry.applyBeforeRequest(pluginCtx);
      pluginRegistry.applyAfterRequest(pluginCtx);
      injectedHeaders = pluginCtx.headers;
    }

    // provider patches — 优先从 DB models JSON 读取 patch 配置，无配置时回退自动检测
    const providerModels = parseModels(provider.models || "[]");
    const { body: patchedBody, meta: patchMeta } = applyProviderPatches(currentBody, {
      base_url: provider.base_url,
      api_type: provider.api_type,
      models: providerModels,
    });
    iterationSnapshot.add({ stage: "provider_patch", types: patchMeta.types });

    const encryptionKey = getSetting(deps.db, "encryption_key");
    if (!encryptionKey) {
      return rejectAndReply(reply, rCtx, errors.providerUnavailable(),
        `Encryption key not configured`, provider.id);
    }
    const apiKey = decrypt(provider.api_key, encryptionKey);
    options?.beforeSendProxy?.(patchedBody, isStream);

    // logging — 使用 rawBody 作为 client_request，patchedBody 作为 upstream_request
    const reqBodyStr = JSON.stringify(patchedBody);
    const clientReq = JSON.stringify({ headers: cliHdrs, body: rawBody });
    const upstreamReqBase = JSON.stringify({
      url: buildUpstreamUrl(provider.base_url, effectiveUpstreamPath),
      headers: sanitizeHeadersForLog(buildUpstreamHeaders(cliHdrs, apiKey, Buffer.byteLength(reqBodyStr), effectiveApiType)),
      body: reqBodyStr,
    });

    const formatTransform = needsTransform ? coordinator.createFormatTransform(apiType, provider.api_type, resolved.backend_model) : undefined;
    if (formatTransform) {
      formatTransform.on("warning", (err) => request.log.warn({ err, logId }, "formatTransform warning"));
    }
    const responseTransform = needsTransform ? (bodyStr: string): string => {
      try {
        const parsed = JSON.parse(bodyStr);
        if (parsed.type === "error" || parsed.error) {
          return coordinator.transformErrorResponse(bodyStr, provider.api_type, apiType);
        }
        let transformed = coordinator.transformResponse(bodyStr, provider.api_type, apiType);
        if (pluginRegistry && !isStream) {
          try {
            const respObj = JSON.parse(transformed);
            const respCtx: import("../transform/plugin-types.js").ResponseTransformContext = {
              response: respObj,
              sourceApiType: provider.api_type as "openai" | "openai-responses" | "anthropic",
              targetApiType: apiType,
              provider: { id: provider.id, name: provider.name, base_url: provider.base_url, api_type: provider.api_type },
            };
            pluginRegistry.applyBeforeResponse(respCtx);
            pluginRegistry.applyAfterResponse(respCtx);
            transformed = JSON.stringify(respCtx.response);
          } catch { /* response hooks best-effort */ }
        }
        return transformed;
      } catch (err) {
        request.log.error({ err }, "responseTransform failed");
        return bodyStr;
      }
    } : undefined;

    const transportFn = buildTransportFn({
      provider, apiKey, body: patchedBody, cliHdrs, reply, upstreamPath: effectiveUpstreamPath, apiType: effectiveApiType,
      isStream, startTime, logId, effectiveModel, originalModel,
      streamTimeoutMs: config.STREAM_TIMEOUT_MS, tracker, matcher, request,
      streamLoopEnabled, formatTransform, responseTransform, injectedHeaders,
    });

    const pipelineSnapshot = iterationSnapshot.toJSON();

    try {
      const resilienceResult = await deps.orchestrator.handle(
        request, reply, apiType,
        { resolved, provider, clientModel: effectiveModel, isStream, trackerId: logId, sessionId, clientRequest: clientReq, upstreamRequest: upstreamReqBase, concurrencyOverride },
        { retryBaseDelayMs: config.RETRY_BASE_DELAY_MS, isFailover, ruleMatcher: matcher, transportFn },
      );
      const lastLogId = logResilienceResult(
        deps.db,
        {
          apiType, model: effectiveModel, providerId: provider.id, isStream,
          clientReq, upstreamReqBase, logId, routerKeyId, originalModel, sessionId,
          failover: { isFailoverIteration, rootLogId: rootLogId! },
          pipelineSnapshot,
          matcher, logFileWriter,
        },
        resilienceResult.attempts, resilienceResult.result, startTime,
      );
      collectTransportMetrics(deps.db, apiType, resilienceResult.result, isStream, lastLogId, provider.id, resolved.backend_model, request, routerKeyId, getTransportStatusCode(resilienceResult.result));

      const tr = resilienceResult.result;
      const succeeded = tr.kind === "success" || tr.kind === "stream_success" || tr.kind === "stream_abort";

      if (succeeded) usageWindowTracker?.recordRequest(provider.id, routerKeyId ?? undefined);

      if (isStream && tracker) {
        const sc = tracker.get(logId)?.streamContent;
        const blocks = sc?.blocks;
        const hasStructured = blocks && blocks.length > 0 && blocks.some(b => b.type !== "text");
        const content = hasStructured
          ? serializeBlocksForStorage(blocks, apiType)
          : (sc?.textContent || "");
        if (content) updateLogStreamContent(deps.db, lastLogId, content);
      }

      if (isFailover && !reply.raw.headersSent) {
        const tr = resilienceResult.result;
        const failed = tr.kind === "throw"
          || ("statusCode" in tr && tr.statusCode >= HTTP_ERROR_THRESHOLD);
        if (failed) {
          excludeTargets.push(resolved);
          continue;
        }
      }

      // orchestrator.sendResponse 对 throw/stream_success/stream_abort 不发送，
      // 对 failover 场景的错误也不发送——这些情况需要外层 proxy-handler 处理
      if (!reply.raw.headersSent) {
        const tr = resilienceResult.result;
        if (tr.kind === "success") {
          // response transform — 注入 model info tag
          const { body: finalBody, meta: respMeta } = maybeInjectModelInfoTag(tr.body, originalModel, effectiveModel);
          if (respMeta.model_info_tag_injected) {
            iterationSnapshot.add({ stage: "response_transform", model_info_tag_injected: true });
            updateLogPipelineSnapshot(deps.db, lastLogId, iterationSnapshot.toJSON());
          }
          return reply.code(tr.statusCode).send(finalBody);
        }
        if (tr.kind === "throw" || (tr.kind === "error" && tr.statusCode >= HTTP_ERROR_THRESHOLD)) {
          const err = errors.upstreamConnectionFailed();
          updateLogClientStatus(deps.db, lastLogId, err.statusCode);
          return reply.code(err.statusCode).send(err.body);
        }
      }

      return reply;
    } catch (e) {
      if (e instanceof ProviderSwitchNeeded) {
        // headers 已发送给客户端时不能 failover，直接返回
        if (reply.raw.headersSent) {
          return reply;
        }
        // 跨 provider failover：resilience 层携带了 attempts 数据，补写失败日志
        if (e.attempts && e.attempts.length > 0) {
          const fakeResult = e.lastResult ?? { kind: "throw" as const, error: new Error("provider switch") };
          logResilienceResult(
            deps.db,
            {
              apiType, model: effectiveModel, providerId: provider.id, isStream,
              clientReq, upstreamReqBase, logId, routerKeyId, originalModel, sessionId,
              failover: { isFailoverIteration, rootLogId: rootLogId! },
              pipelineSnapshot,
              matcher, logFileWriter,
            },
            e.attempts, fakeResult, startTime,
          );
        }
        request.log.debug({ logId, action: "provider_switch", targetProviderId: e.targetProviderId });
        excludeTargets.push(resolved);
        continue;
      }
      if (e instanceof SemaphoreQueueFullError) {
        return rejectAndReply(reply, rCtx, errors.concurrencyQueueFull(provider.id),
          `Concurrency queue full for provider '${provider.id}'`, provider.id);
      }
      if (e instanceof SemaphoreTimeoutError) {
        return rejectAndReply(reply, rCtx, errors.concurrencyTimeout(provider.id, e.timeoutMs),
          `Concurrency wait timeout for provider '${provider.id}' (${e.timeoutMs}ms)`, provider.id);
      }
      const errMsg = e instanceof Error ? e.message : String(e);
      request.log.debug({ logId, error: errMsg, action: "upstream_error" });
      insertRequestLog(deps.db, {
        id: logId, api_type: apiType, model: effectiveModel, provider_id: provider.id,
        status_code: UPSTREAM_ERROR_STATUS, latency_ms: Date.now() - startTime, is_stream: isStream ? 1 : 0,
        error_message: errMsg || "Upstream connection failed", created_at: new Date().toISOString(),
        client_request: clientReq, upstream_request: upstreamReqBase,
        is_failover: isFailoverIteration ? 1 : 0, original_request_id: isFailoverIteration ? rootLogId : null,
        router_key_id: routerKeyId, original_model: originalModel,
        session_id: sessionId,
        pipeline_snapshot: pipelineSnapshot,
      }, (matcher || logFileWriter) ? {
        matcher, logFileWriter, responseBody: null,
      } : undefined);
      const err = errors.upstreamConnectionFailed();
      return reply.code(err.statusCode).send(err.body);
    }
  }
}



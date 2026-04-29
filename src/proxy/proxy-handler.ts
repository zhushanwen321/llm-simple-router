import { randomUUID } from "crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import Database from "better-sqlite3";
import { HTTP_UNPROCESSABLE_ENTITY } from "../constants.js";
import { getProviderById, insertRequestLog, updateLogPipelineSnapshot, updateLogStreamContent, updateLogClientStatus } from "../db/index.js";
import { decrypt } from "../utils/crypto.js";
import { getSetting } from "../db/settings.js";
import { resolveMapping } from "./mapping-resolver.js";
import { applyEnhancement } from "./enhancement/enhancement-handler.js";
import { SemaphoreQueueFullError, SemaphoreTimeoutError } from "./semaphore.js";
import type { RequestTracker } from "../monitor/request-tracker.js";
import {
  logResilienceResult,
  collectTransportMetrics,
  handleIntercept,
  sanitizeHeadersForLog,
} from "./proxy-logging.js";
import { buildUpstreamHeaders, buildUpstreamUrl } from "./proxy-core.js";
import { ProviderSwitchNeeded } from "./types.js";
import type { RawHeaders, TransportResult } from "./types.js";
import type { Target } from "./strategy/types.js";
import { insertRejectedLog } from "./log-helpers.js";
import type { RetryRuleMatcher } from "./retry-rules.js";
import type { ProxyOrchestrator } from "./orchestrator.js";
import type { ProxyErrorFormatter, ProxyErrorResponse } from "./proxy-core.js";
import { buildTransportFn } from "./transport-fn.js";
import { applyOverflowRedirect } from "./overflow.js";
import { applyProviderPatches } from "./patch/index.js";
import { PipelineSnapshot, type StageRecord } from "./pipeline-snapshot.js";
import { maybeInjectModelInfoTag } from "./response-transform.js";

const HTTP_ERROR_THRESHOLD = 400;
const MAX_LOG_FIELD_LENGTH = 80;
const UPSTREAM_ERROR_STATUS = 502;

/** 从 TransportResult 中提取最终 HTTP status code */
function getTransportStatusCode(result: TransportResult): number | null {
  if (result.kind === "success" || result.kind === "error" || result.kind === "stream_error") return result.statusCode;
  if (result.kind === "stream_success" || result.kind === "stream_abort") return result.statusCode;
  // kind === "throw"：无 HTTP 状态码
  return null;
}

// ---------- Failover loop context ----------

interface FailoverContext {
  request: FastifyRequest;
  reply: FastifyReply;
  apiType: "openai" | "anthropic";
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
}

// ---------- Helpers ----------

interface RejectParams {
  db: Database.Database;
  logId: string;
  apiType: "openai" | "anthropic";
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
  });
  return reply.code(error.statusCode).send(error.body);
}

export interface RouteHandlerDeps {
  db: Database.Database;
  streamTimeoutMs: number;
  retryBaseDelayMs: number;
  matcher?: RetryRuleMatcher;
  tracker?: RequestTracker;
  orchestrator: ProxyOrchestrator;
  usageWindowTracker?: import("./usage-window-tracker.js").UsageWindowTracker;
}

import type { ContentBlock } from "../monitor/types.js";

/** 将 tracker blocks 序列化为前端 tryDirectParse 可解析的 JSON */
function serializeBlocksForStorage(blocks: ContentBlock[] | undefined, apiType: "openai" | "anthropic"): string {
  if (!blocks || blocks.length === 0) return "";
  if (apiType === "anthropic") {
    const content = blocks.map(b => {
      if (b.type === "thinking") return { type: "thinking", thinking: b.content };
      if (b.type === "tool_use") {
        let input = {};
        try { input = JSON.parse(b.content || "{}"); } catch { /* eslint-disable-line taste/no-silent-catch -- tool_use content 非合法 JSON 时保留空对象 */ }
        return { type: "tool_use", name: b.name ?? "", input };
      }
      return { type: "text", text: b.content };
    });
    return JSON.stringify({ content });
  }
  const text = blocks.filter(b => b.type === "text").map(b => b.content).join("");
  return JSON.stringify({ choices: [{ message: { content: text } }] });
}

// ---------- Main entry ----------

export async function handleProxyRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  apiType: "openai" | "anthropic",
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

  // 在所有加工之前捕获原始 body
  const rawBody = JSON.parse(JSON.stringify(request.body as Record<string, unknown>));
  const snapshot = new PipelineSnapshot();

  // enhancement 阶段
  const { body: enhancedBody, effectiveModel, originalModel, interceptResponse, meta: enhMeta } = applyEnhancement(
    deps.db, request.body as Record<string, unknown>, clientModel, sessionId, request.routerKey,
  );
  snapshot.add({ stage: "enhancement", router_tags_stripped: enhMeta.router_tags_stripped, directive: enhMeta.directive });

  // tool guard 阶段 — 使用 enhancedBody
  let pipelineBody = enhancedBody;
  if (deps.sessionTracker && sessionId) {
    const routerKeyId = (request.routerKey as { id?: string } | undefined)?.id ?? null;
    const sessionKey = routerKeyId ? `${routerKeyId}:${sessionId}` : sessionId;
    const lastToolUse = extractLastToolUse(enhancedBody);
    if (lastToolUse) {
      const toolGuard = new ToolLoopGuard(deps.sessionTracker, {
        enabled: true,
        minConsecutiveCount: 3,
        detectorConfig: { n: 6, windowSize: 500, repeatThreshold: 5 },
      });
      const checkResult = toolGuard.check(sessionKey, lastToolUse);
      if (checkResult.detected) {
        const loopCount = deps.sessionTracker.getLoopCount(sessionKey);
        if (loopCount === 1) {
          // 层级 1：透明重试 — 注入中断提示词
          pipelineBody = toolGuard.injectLoopBreakPrompt(enhancedBody, apiType, lastToolUse.toolName);
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

  if (interceptResponse) return handleIntercept(deps.db, apiType, request, reply, interceptResponse, clientModel, sessionId, snapshot.toJSON());

  return executeFailoverLoop({
    request, reply, apiType, upstreamPath, errors, deps, options,
    effectiveModel, originalModel,
    pipelineBody,
    rawBody,
    baseStages: snapshot.getStages() as StageRecord[],
    sessionId,
  });
}

// ---------- Failover loop ----------

async function executeFailoverLoop(ctx: FailoverContext): Promise<FastifyReply> {
  const { request, reply, apiType, upstreamPath, errors, deps, options, effectiveModel, originalModel, pipelineBody, rawBody, baseStages, sessionId } = ctx;
  const excludeTargets: Target[] = [];
  let rootLogId: string | null = null;
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
    if (provider.api_type !== apiType) {
      return rejectAndReply(reply, rCtx, errors.providerTypeMismatch(),
        `API type mismatch: expected '${apiType}'`, resolved.provider_id);
    }

    // routing — 创建新对象而非 in-place mutation
    currentBody = { ...currentBody, model: resolved.backend_model };
    iterationSnapshot.add({ stage: "routing", client_model: effectiveModel, backend_model: resolved.backend_model, provider_id: resolved.provider_id, strategy: resolveResult.targetCount > 1 ? "failover" : "scheduled" });

    // --- 溢出重定向：上下文超出时切换到更大模型 ---
    const overflowResult = applyOverflowRedirect(resolved, deps.db, currentBody);
    if (overflowResult) {
      const overflowProvider = getProviderById(deps.db, overflowResult.provider_id);
      if (overflowProvider && overflowProvider.is_active && overflowProvider.api_type === apiType) {
        resolved = { ...resolved, provider_id: overflowResult.provider_id, backend_model: overflowResult.backend_model };
        provider = overflowProvider;
        currentBody = { ...currentBody, model: overflowResult.backend_model };
        iterationSnapshot.add({ stage: "overflow", triggered: true, redirect_to: overflowResult.backend_model, redirect_provider: overflowResult.provider_id });
      }
    } else {
      iterationSnapshot.add({ stage: "overflow", triggered: false });
    }

    // provider patches — 使用返回值
    const { body: patchedBody, meta: patchMeta } = applyProviderPatches(currentBody, provider);
    iterationSnapshot.add({ stage: "provider_patch", types: patchMeta.types });

    const apiKey = decrypt(provider.api_key, getSetting(deps.db, "encryption_key")!);
    options?.beforeSendProxy?.(patchedBody, isStream);

    // logging — 使用 rawBody 作为 client_request，patchedBody 作为 upstream_request
    const reqBodyStr = JSON.stringify(patchedBody);
    const clientReq = JSON.stringify({ headers: cliHdrs, body: rawBody });
    const upstreamReqBase = JSON.stringify({
      url: buildUpstreamUrl(provider.base_url, upstreamPath),
      headers: sanitizeHeadersForLog(buildUpstreamHeaders(cliHdrs, apiKey, Buffer.byteLength(reqBodyStr), apiType)),
      body: reqBodyStr,
    });

    const transportFn = buildTransportFn({
      provider, apiKey, body: patchedBody, cliHdrs, reply, upstreamPath, apiType,
      isStream, startTime, logId, effectiveModel, originalModel,
      streamTimeoutMs: deps.streamTimeoutMs, tracker: deps.tracker, matcher: deps.matcher, request,
    });

    const pipelineSnapshot = iterationSnapshot.toJSON();

    try {
      const resilienceResult = await deps.orchestrator.handle(
        request, reply, apiType,
        { resolved, provider, clientModel: effectiveModel, isStream, trackerId: logId, sessionId, clientRequest: clientReq, concurrencyOverride },
        { retryBaseDelayMs: deps.retryBaseDelayMs, isFailover, ruleMatcher: deps.matcher, transportFn },
      );
      const lastLogId = logResilienceResult(
        deps.db,
        {
          apiType, model: effectiveModel, providerId: provider.id, isStream,
          clientReq, upstreamReqBase, logId, routerKeyId, originalModel, sessionId,
          failover: { isFailoverIteration, rootLogId: rootLogId! },
          pipelineSnapshot,
        },
        resilienceResult.attempts, resilienceResult.result, startTime,
      );
      collectTransportMetrics(deps.db, apiType, resilienceResult.result, isStream, lastLogId, provider.id, resolved.backend_model, request, routerKeyId, getTransportStatusCode(resilienceResult.result));

      const tr = resilienceResult.result;
      const succeeded = tr.kind === "success" || tr.kind === "stream_success" || tr.kind === "stream_abort";
      if (succeeded) deps.usageWindowTracker?.recordRequest(provider.id, routerKeyId ?? undefined);

      if (isStream && deps.tracker) {
        const sc = deps.tracker.get(logId)?.streamContent;
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
      });
      const err = errors.upstreamConnectionFailed();
      return reply.code(err.statusCode).send(err.body);
    }
  }
}

import { randomUUID } from "crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import Database from "better-sqlite3";
import { getMappingGroup, getProviderById, insertRequestLog } from "../db/index.js";
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
import { buildUpstreamHeaders } from "./proxy-core.js";
import { ProviderSwitchNeeded } from "./types.js";
import type { RawHeaders } from "./types.js";
import { updateLogStreamContent } from "../db/index.js";
import { countTokens } from "gpt-tokenizer";
import { insertRejectedLog } from "./log-helpers.js";
import type { Target } from "./strategy/types.js";
import type { RetryRuleMatcher } from "./retry-rules.js";
import type { ProxyOrchestrator } from "./orchestrator.js";
import type { ProxyErrorFormatter, ProxyErrorResponse } from "./proxy-core.js";
import { buildTransportFn } from "./transport-fn.js";
import { lookupContextWindow, COMPACT_THRESHOLD } from "../config/model-context.js";
import { getModelContextWindowOverride } from "../db/model-info.js";

const HTTP_ERROR_THRESHOLD = 400;

/**
 * DeepSeek 等 provider 的 thinking 协议实现不完整：
 * 开启 thinking 模式后部分轮次（tool_use/纯文本）不返回 thinking block，
 * 但后续请求又要求历史 assistant 消息必须携带 thinking block。
 * DeepSeek 甚至在不传 thinking 参数时也从历史推断并启用 thinking 模式。
 * 在 content 数组开头补一个空 thinking block 以绕过上游校验。
 */
function patchMissingThinkingBlocks(
  body: Record<string, unknown>,
  providerBaseUrl: string,
): void {
  if (!body.messages || !providerBaseUrl.includes("deepseek")) return;

  const messages = body.messages as Array<{ role: string; content: unknown }>;

  // DeepSeek 可能在不传 thinking 参数时也启用 thinking 模式（从历史推断），
  // 所以只要历史中存在任何 thinking block，就视为 thinking 模式激活。
  const thinkingActive = !!body.thinking || messages.some(
    (msg) => msg.role === "assistant" && Array.isArray(msg.content)
      && (msg.content as Array<Record<string, unknown>>).some(
        (b) => b && typeof b === "object" && b.type === "thinking",
      ),
  );
  if (!thinkingActive) return;

  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    const hasThinking = (msg.content as Array<Record<string, unknown>>).some(
      (b) => b && typeof b === "object" && b.type === "thinking",
    );
    if (!hasThinking) {
      (msg.content as Array<Record<string, unknown>>).unshift({ type: "thinking", thinking: "", signature: "" });
    }
  }
}
const MAX_LOG_FIELD_LENGTH = 80;
const UPSTREAM_ERROR_STATUS = 502;

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
  isFailover: boolean;
  originalBody: Record<string, unknown>;
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
    sessionId: params.sessionId,
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
  request.raw.socket.on("error", (err) => request.log.debug({ err }, "client socket error"));
  const clientModel = ((request.body as Record<string, unknown>).model as string) || "unknown";
  const sessionId = (request.headers as RawHeaders)["x-claude-code-session-id"] as string | undefined;
  const { effectiveModel, originalModel, interceptResponse } = applyEnhancement(deps.db, request, clientModel, sessionId);

  if (interceptResponse) return handleIntercept(deps.db, apiType, request, reply, interceptResponse, clientModel, sessionId);

  const group = getMappingGroup(deps.db, effectiveModel);
  return executeFailoverLoop({
    request, reply, apiType, upstreamPath, errors, deps, options,
    effectiveModel, originalModel,
    isFailover: group?.strategy === "failover",
    originalBody: JSON.parse(JSON.stringify(request.body as Record<string, unknown>)),
    sessionId,
  });
}

// ---------- Failover loop ----------

async function executeFailoverLoop(ctx: FailoverContext): Promise<FastifyReply> {
  const { request, reply, apiType, upstreamPath, errors, deps, options, effectiveModel, originalModel, isFailover, originalBody, sessionId } = ctx;
  const excludeTargets: Target[] = [];
  let rootLogId: string | null = null;
  const compactConfig = getCompactConfig(deps.db);

  while (true) {
    const startTime = Date.now();
    const logId = randomUUID();
    if (rootLogId === null) rootLogId = logId;
    const isFailoverIteration = rootLogId !== logId;
    const routerKeyId = request.routerKey?.id ?? null;
    const body = request.body as Record<string, unknown>;
    const isStream = body.stream === true;
    const cliHdrs: RawHeaders = request.headers as RawHeaders;

    const rCtx: RejectParams = {
      db: deps.db, logId, apiType, model: effectiveModel,
      startTime, isStream, routerKeyId, originalBody, clientHeaders: cliHdrs, originalModel,
      isFailover: isFailoverIteration, originalRequestId: isFailoverIteration ? rootLogId : null, sessionId,
    };

    let resolved = resolveMapping(deps.db, effectiveModel, { now: new Date(), excludeTargets });
    request.log.debug({ logId, model: effectiveModel, apiType, isStream, action: "resolve_mapping", resolved: !!resolved });

    if (!resolved) {
      if (isFailover && excludeTargets.length > 0) {
        return rejectAndReply(reply, { ...rCtx, isFailover: true, originalRequestId: rootLogId },
          errors.upstreamConnectionFailed(), `All failover targets exhausted (${excludeTargets.length} attempted)`);
      }
      return rejectAndReply(reply, rCtx, errors.modelNotFound(effectiveModel), `No mapping found for model '${effectiveModel}'`);
    }

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

    body.model = resolved.backend_model;

    // --- 1M Context Compact ---
    if (compactConfig) {
      if (isCompactRequest(body.messages as unknown[])) {
        // compact 请求 -> 重定向到 1M 模型
        const compactProvider = compactConfig.compact_provider_id
          ? getProviderById(deps.db, compactConfig.compact_provider_id)
          : undefined;
        if (compactProvider && compactConfig.compact_model) {
          if (compactProvider.api_type !== apiType) {
            request.log.warn({ expected: apiType, got: compactProvider.api_type }, "compact provider api_type mismatch, skipping redirect");
          } else {
            request.log.info({ from: resolved.backend_model, to: compactConfig.compact_model }, "redirecting compact request to 1M model");
            resolved = { backend_model: compactConfig.compact_model, provider_id: compactProvider.id };
            provider = compactProvider;
            body.model = compactConfig.compact_model;
            if (compactConfig.custom_prompt_enabled && compactConfig.custom_prompt) {
              body.messages = replaceCompactPrompt(body.messages as unknown[], compactConfig.custom_prompt);
            }
          }
        }
      } else {
        // 普通请求 -> 检查上下文超限（仅对 context_window < 1M 的模型检查）
        const modelCtx = getModelContextWindow(deps.db, resolved.provider_id, resolved.backend_model);
        if (modelCtx && modelCtx < COMPACT_THRESHOLD) {
          const estimated = estimateTokens(body);
          if (estimated > modelCtx) {
            request.log.info({ model: resolved.backend_model, estimated, limit: modelCtx }, "context overflow detected");
            return rejectAndReply(reply, rCtx, errors.promptTooLong(),
              `Context overflow: ${estimated} tokens > ${modelCtx} limit`, resolved.provider_id);
          }
        }
      }
    }

    patchMissingThinkingBlocks(body, provider.base_url);
    const apiKey = decrypt(provider.api_key, getSetting(deps.db, "encryption_key")!);
    options?.beforeSendProxy?.(body, isStream);

    const reqBodyStr = JSON.stringify(body);
    const clientReq = JSON.stringify({ headers: cliHdrs, body: originalBody });
    const upstreamReqBase = JSON.stringify({
      url: `${provider.base_url}${upstreamPath}`,
      headers: sanitizeHeadersForLog(buildUpstreamHeaders(cliHdrs, apiKey, Buffer.byteLength(reqBodyStr))),
      body: reqBodyStr,
    });

    const transportFn = buildTransportFn({
      provider, apiKey, body, cliHdrs, reply, upstreamPath, apiType,
      isStream, startTime, logId, effectiveModel, originalModel,
      streamTimeoutMs: deps.streamTimeoutMs, tracker: deps.tracker, matcher: deps.matcher, request,
    });

    try {
      const resilienceResult = await deps.orchestrator.handle(
        request, reply, apiType,
        { resolved, provider, clientModel: effectiveModel, isStream, trackerId: logId, sessionId, clientRequest: clientReq },
        { retryBaseDelayMs: deps.retryBaseDelayMs, isFailover, ruleMatcher: deps.matcher, transportFn },
      );
      const lastLogId = logResilienceResult(
        deps.db,
        {
          apiType, model: effectiveModel, providerId: provider.id, isStream,
          clientReq, upstreamReqBase, logId, routerKeyId, originalModel, sessionId,
          failover: { isFailoverIteration, rootLogId: rootLogId! },
        },
        resilienceResult.attempts, resilienceResult.result, startTime,
      );
      collectTransportMetrics(deps.db, apiType, resilienceResult.result, isStream, lastLogId, provider.id, resolved.backend_model, request);

      const tr = resilienceResult.result;
      const succeeded = tr.kind === "success" || tr.kind === "stream_success" || tr.kind === "stream_abort";
      if (succeeded) deps.usageWindowTracker?.recordRequest(routerKeyId ?? undefined);

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
        if (tr.kind === "throw" || (tr.kind === "error" && tr.statusCode >= HTTP_ERROR_THRESHOLD)) {
          const err = errors.upstreamConnectionFailed();
          return reply.code(err.statusCode).send(err.body);
        }
      }

      return reply;
    } catch (e) {
      if (e instanceof ProviderSwitchNeeded) {
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
      });
      const err = errors.upstreamConnectionFailed();
      return reply.code(err.statusCode).send(err.body);
    }
  }
}

// --- 1M Context Compact helpers ---

interface CompactConfig {
  context_compact_enabled: boolean;
  compact_provider_id: string | null;
  compact_model: string | null;
  custom_prompt_enabled: boolean;
  custom_prompt: string | null;
}

// Claude Code compact prompt 一定以 NO_TOOLS_PREAMBLE 开头，且 content 是纯字符串（非数组）
const COMPACT_PREAMBLE = "CRITICAL: Respond with TEXT ONLY";

function isCompactRequest(messages: unknown[]): boolean {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  const last = messages[messages.length - 1] as Record<string, unknown> | undefined;
  if (!last || last.role !== "user") return false;
  return typeof last.content === "string" && last.content.startsWith(COMPACT_PREAMBLE);
}

// Anthropic API 对图片按固定 ~2000 tokens 计费，而非 base64 字符数
const ESTIMATED_TOKENS_PER_IMAGE = 2000;

/** 递归剥离 base64 数据，用占位符替代，避免 gpt-tokenizer 对 base64 过度计数 */
function stripBase64ForEstimation(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(stripBase64ForEstimation);
  if (obj && typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    // Anthropic image block: { type: "image", source: { type: "base64", data: "..." } }
    if (record.type === "image" && record.source && typeof record.source === "object") {
      const src = record.source as Record<string, unknown>;
      if (src.type === "base64" && typeof src.data === "string") {
        return { ...record, source: { ...src, data: "[BASE64]" } };
      }
    }
    // OpenAI image_url block: { type: "image_url", image_url: { url: "data:image/...;base64,..." } }
    if (record.type === "image_url" && record.image_url && typeof record.image_url === "object") {
      const iu = record.image_url as Record<string, unknown>;
      if (typeof iu.url === "string" && iu.url.startsWith("data:")) {
        return { ...record, image_url: { ...iu, url: "[DATA_URL]" } };
      }
    }
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) result[k] = stripBase64ForEstimation(v);
    return result;
  }
  return obj;
}

/** 统计 content 数组中的图片数量（Anthropic 和 OpenAI 格式） */
function countImageBlocks(obj: unknown): number {
  if (Array.isArray(obj)) return obj.reduce((sum: number, item) => sum + countImageBlocks(item), 0);
  if (obj && typeof obj === "object") {
    const r = obj as Record<string, unknown>;
    if (r.type === "image" || r.type === "image_url") return 1;
    return Object.values(r).reduce((sum: number, v) => sum + countImageBlocks(v), 0);
  }
  return 0;
}

function estimateTokens(body: Record<string, unknown>): number {
  const imageCount = countImageBlocks(body);
  const cleaned = stripBase64ForEstimation(body);
  return countTokens(JSON.stringify(cleaned)) + imageCount * ESTIMATED_TOKENS_PER_IMAGE;
}

function getCompactConfig(db: Database.Database): CompactConfig | null {
  const raw = getSetting(db, "proxy_enhancement");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed.context_compact_enabled ? (parsed as CompactConfig) : null;
  } catch { /* eslint-disable-line taste/no-silent-catch -- proxy_enhancement 配置无效时静默降级 */ }
  return null;
}

function getModelContextWindow(db: Database.Database, providerId: string, modelName: string): number | null {
  const override = getModelContextWindowOverride(db, providerId, modelName);
  return override ?? lookupContextWindow(modelName);
}

function replaceCompactPrompt(messages: unknown[], customPrompt: string): unknown[] {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const last = { ...(messages[messages.length - 1] as Record<string, unknown>) };
  last.content = customPrompt;
  return [...messages.slice(0, -1), last];
}

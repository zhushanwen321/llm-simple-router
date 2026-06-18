/**
 * Iteration setup — 从 failover-loop.ts 提取。
 *
 * 每次 failover 迭代的准备阶段：格式转换、plugin 调整、provider patches、
 * transport function 构建。
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { getProviderById } from "../../db/index.js";
import { resolveEndpoint } from "../routing/resolve-endpoint.js";
import type { ProxyErrorFormatter } from "../proxy-core.js";
import type { FormatAdapter } from "../format/types.js";
import type { FormatRegistry } from "../format/registry.js";
import { sanitizeHeadersForLog } from "../proxy-logging.js";
import { buildUpstreamHeaders } from "../proxy-core.js";
import { buildUpstreamUrl } from "../transport/shared.js";
import { getModelTimeouts } from "../../db/providers.js";
import { buildTransportFn } from "../transport/transport-fn.js";
import { parseModels } from "../../config/model-context.js";
import { applyProviderPatches } from "../patch/index.js";
import { loadEnhancementConfig } from "../routing/enhancement-config.js";
import type { Target, MappingReason } from "../../core/types.js";
import type { RawHeaders } from "../types.js";
import { PipelineSnapshot } from "../pipeline-snapshot.js";
import type { RetryRuleMatcher } from "../orchestration/retry-rules.js";
import type { RequestTracker } from "../../core/monitor/index.js";
import type { ProxyAgentFactory } from "../transport/proxy-agent.js";
import type { PluginRegistry } from "../transform/plugin-registry.js";
import type { ResponseTransformContext } from "../transform/plugin-types.js";
import type { ApiType } from "../transform/types.js";
import type { RejectParams } from "./reject-helpers.js";
import { rejectAndReply, applyPluginAdjustments } from "./reject-helpers.js";

// ---------- Iteration setup ----------

export type IterationSetupResult =
  | { ok: true; transportFn: ReturnType<typeof buildTransportFn>; upstreamReqBase: string; pipelineSnapshot: string; resolvedEndpoint: ReturnType<typeof resolveEndpoint>; flushCurrentErrors: () => void }
  | { ok: false; reply: FastifyReply };

export function buildIterationSetup(params: {
  formatRegistry: FormatRegistry;
  pluginRegistry: PluginRegistry;
  currentBody: Record<string, unknown>;
  ctxApiType: string;
  clientApiType: string;
  provider: NonNullable<ReturnType<typeof getProviderById>>;
  resolved: Target;
  upstreamPath: string;
  encryptionKey: string | null;
  cliHdrs: RawHeaders;
  reply: FastifyReply;
  startTime: number;
  logId: string;
  clientModel: string;
  precomputedClientReq: string;
  enhancementConfig: ReturnType<typeof loadEnhancementConfig>;
  tracker: RequestTracker;
  matcher: RetryRuleMatcher;
  request: FastifyRequest;
  adapter: FormatAdapter;
  proxyAgentFactory?: ProxyAgentFactory;
  iterationSnapshot: PipelineSnapshot;
  effectiveMappingReason: MappingReason;
  isStream: boolean;
  isFailover: boolean;
  flushToolErrors: (providerId: string, model: string, reqLogId: string) => void;
  errors: ProxyErrorFormatter;
  rCtx: RejectParams;
}): IterationSetupResult {
  const {
    formatRegistry, pluginRegistry, provider, resolved, upstreamPath,
    cliHdrs, reply, startTime, logId, clientModel,
    enhancementConfig, tracker, matcher, request, adapter, proxyAgentFactory,
    iterationSnapshot, effectiveMappingReason, isStream, isFailover, flushToolErrors, errors, rCtx,
  } = params;
  let currentBody = params.currentBody;
  const ctxApiType = params.ctxApiType as ApiType;
  const clientApiType = params.clientApiType as ApiType;

  // encryptionKey check
  if (!params.encryptionKey) {
    return {
      ok: false,
      reply: rejectAndReply(reply, rCtx, errors.providerUnavailable(),
        `Encryption key not configured`, provider.id,
        () => flushToolErrors(provider.id, resolved.backend_model ?? clientModel, logId)),
    };
  }

  const resolvedEndpoint = resolveEndpoint(provider, clientApiType, params.encryptionKey);
  const flushCurrentErrors = () => flushToolErrors(provider.id, resolved.backend_model ?? clientModel, logId);

  // --- 格式转换 + upstreamPath 决策 ---
  const resolvedPath = resolveUpstreamPath(formatRegistry, currentBody, ctxApiType, resolvedEndpoint.api_type as ApiType, resolvedEndpoint.upstream_path ?? undefined, upstreamPath, resolved.backend_model ?? clientModel ?? "");
  currentBody = resolvedPath.body;
  const effectiveApiType = resolvedPath.effectiveApiType;
  const effectiveUpstreamPath = resolvedPath.effectiveUpstreamPath;
  const needsTransform = resolvedPath.needsTransform;

  // --- routing ---
  currentBody = { ...currentBody, model: resolved.backend_model };
  iterationSnapshot.add({ stage: "routing", client_model: clientModel, backend_model: resolved.backend_model, provider_id: resolved.provider_id, strategy: isFailover ? "failover" : "scheduled", mapping_reason: effectiveMappingReason });

  // --- Plugin 调整 body 和 headers ---
  const pluginResult = applyPluginAdjustments(pluginRegistry, currentBody, clientApiType, { id: provider.id, name: provider.name, base_url: resolvedEndpoint.base_url, api_type: resolvedEndpoint.api_type });
  const injectedHeaders = pluginResult.headers;

  // --- Provider patches ---
  const providerModels = parseModels(provider.models || "[]");
  const { body: patchedBody, meta: patchMeta } = applyProviderPatches(currentBody, {
    base_url: resolvedEndpoint.base_url,
    api_type: resolvedEndpoint.api_type,
    models: providerModels,
  });
  iterationSnapshot.add({ stage: "provider_patch", types: patchMeta.types });

  // --- API key (resolvedEndpoint.api_key 已解密) ---
  const apiKey = resolvedEndpoint.api_key;

  // --- beforeSendProxy + Build logging data ---
  adapter.beforeSendProxy?.(patchedBody, isStream);
  const reqBodyStr = JSON.stringify(patchedBody);
  const upstreamReqBase = JSON.stringify({
    url: buildUpstreamUrl(resolvedEndpoint.base_url, effectiveUpstreamPath),
    headers: sanitizeHeadersForLog(buildUpstreamHeaders(cliHdrs, apiKey, Buffer.byteLength(reqBodyStr), effectiveApiType)),
    body: reqBodyStr,
  });

  // --- Stream transforms ---
  const formatTransform = needsTransform ? formatRegistry.createStreamTransform(resolvedEndpoint.api_type, ctxApiType, resolved.backend_model) : undefined;
  if (formatTransform) {
    formatTransform.on("warning", (err) => request.log.warn({ err, logId }, "formatTransform warning"));
  }

  const responseTransform = needsTransform ? (bodyStr: string): string => {
    try {
      const parsed = JSON.parse(bodyStr) as Record<string, unknown>;
      if (parsed.type === "error" || parsed.error) {
        return formatRegistry.transformError(parsed, resolvedEndpoint.api_type, ctxApiType);
      }
      let transformed = formatRegistry.transformResponse(parsed, resolvedEndpoint.api_type, ctxApiType);
      if (pluginRegistry && !isStream) {
        try {
          const respCtx: ResponseTransformContext = {
            response: transformed,
            sourceApiType: resolvedEndpoint.api_type as "openai" | "openai-responses" | "anthropic",
            targetApiType: clientApiType,
            provider: { id: provider.id, name: provider.name, base_url: resolvedEndpoint.base_url, api_type: resolvedEndpoint.api_type },
          };
          pluginRegistry.applyBeforeResponse(respCtx);
          pluginRegistry.applyAfterResponse(respCtx);
          transformed = respCtx.response;
        } catch (e: unknown) { request.log.debug({ err: e }, "response transform plugin hook failed"); }
      }
      return JSON.stringify(transformed);
    } catch (err) {
      request.log.error({ err }, "responseTransform failed");
      return bodyStr;
    }
  } : undefined;

  // --- Build transport function ---
  const streamLoopEnabled = enhancementConfig.stream_loop_enabled;
  // 合并 stream/nonStream 超时查询，单次 parseModels（applyProviderPatches 内另有一次解析）
  const modelTimeouts = getModelTimeouts(provider, resolved.backend_model);
  const transportFn = buildTransportFn({
    provider, apiKey, body: patchedBody, cliHdrs, reply, upstreamPath: effectiveUpstreamPath, apiType: effectiveApiType,
    isStream, startTime, logId, effectiveModel: clientModel,
    nonStreamTimeoutMs: modelTimeouts.nonStream,
    streamTimeoutMs: modelTimeouts.stream,
    tracker, matcher, request,
    streamLoopEnabled, formatTransform, responseTransform, injectedHeaders,
    timeoutContext: { modelId: resolved.backend_model, providerId: provider.id },
    proxyAgentFactory,
    resolvedBaseUrl: resolvedEndpoint.base_url,
  });

  const pipelineSnapshot = iterationSnapshot.toJSON();

  return { ok: true, transportFn, upstreamReqBase, pipelineSnapshot, resolvedEndpoint, flushCurrentErrors };
}

// ---------- Internal helpers ----------

function resolveUpstreamPath(
  formatRegistry: FormatRegistry,
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

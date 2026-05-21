/**
 * pre_transport hook: 构建 transport 函数并通过 orchestrator 执行请求。
 *
 * 这是 pre_transport 阶段的核心 hook（priority 300），在 format-transform、
 * api-key-decrypt、provider-patches、plugin-request 等 hook 完成后执行。
 * 以最终的 body 和 headers 状态构建 transport 函数，调用 orchestrator.handle()。
 *
 * 从 failover-loop.ts L241-410 提取，职责包括：
 * 1. adapter.beforeSendProxy()
 * 2. 创建 stream/response 格式转换
 * 3. 构建日志数据（clientRequest, upstreamRequest）
 * 4. buildTransportFn() → orchestrator.handle()
 * 5. 写入 ctx.transportResult + ctx.resilienceResult
 */
import type { PipelineHook, PipelineContext } from "../../pipeline/types.js";
import { SERVICE_KEYS } from "../../../core/container.js";
import type { ServiceContainer } from "../../../core/container.js";
import type { FormatRegistry } from "../../format/registry.js";
import type { FormatAdapter } from "../../format/types.js";
import type { ProxyOrchestrator } from "../../orchestration/orchestrator.js";
import type { PluginRegistry } from "../../transform/plugin-registry.js";
import type { ResponseTransformContext, ProviderInfo as PluginProviderInfo } from "../../transform/plugin-types.js";
import { getConfig } from "../../../config/index.js";
import type { RequestTracker } from "../../../core/monitor/index.js";
import type { RetryRuleMatcher } from "../../orchestration/retry-rules.js";
import type { ProxyAgentFactory } from "../../transport/proxy-agent.js";
import { buildTransportFn } from "../../transport/transport-fn.js";
import { buildUpstreamUrl, buildUpstreamHeaders } from "../../proxy-core.js";
import { sanitizeHeadersForLog } from "../../proxy-logging.js";
import { getModelStreamTimeout } from "../../../db/providers.js";
import type { Provider } from "../../../db/providers.js";
import type { EnhancementConfig } from "../../routing/enhancement-config.js";
import type { Target, ConcurrencyOverride, MappingReason } from "../../../core/types.js";
import type { ApiType } from "../../transform/types.js";
import type { RawHeaders } from "../../types.js";

export const transportExecuteHook: PipelineHook = {
  name: "builtin:transport-execute",
  phase: "pre_transport",
  priority: 300,
  core: true,

  async execute(ctx: PipelineContext): Promise<void> {
    const container = ctx.metadata.get("container") as ServiceContainer;
    const formatRegistry = container.resolve<FormatRegistry>(SERVICE_KEYS.formatRegistry);
    const adapter = ctx.metadata.get("adapter") as FormatAdapter;
    const orchestrator = ctx.metadata.get("orchestrator") as ProxyOrchestrator;
    const tracker = ctx.metadata.get("tracker") as RequestTracker | undefined;
    const matcher = ctx.metadata.get("matcher") as RetryRuleMatcher;
    const proxyAgentFactory = container.resolve<ProxyAgentFactory | undefined>(SERVICE_KEYS.proxyAgentFactory);
    const retryBaseDelayMs = (ctx.metadata.get("retryBaseDelayMs") as number) ?? getConfig().RETRY_BASE_DELAY_MS;

    // route-resolve hook 通过 getProviderById 设置，运行时是完整 Provider 对象
    const provider = ctx.provider as unknown as Provider;
    const resolved = ctx.resolved!;
    const clientApiType = ctx.apiType as ApiType;
    const isStream = ctx.isStream;
    const startTime = ctx.metadata.get("startTime") as number;
    const logId = ctx.logId;
    const apiKey = ctx.metadata.get("apiKey") as string;

    // adapter.beforeSendProxy — 注入 stream_options 等适配逻辑
    adapter.beforeSendProxy?.(ctx.body, isStream);

    // 构建日志数据
    const cliHdrs = ctx.metadata.get("clientHeaders") as RawHeaders;
    const clientRequest = ctx.metadata.get("precomputedClientReq") as string;
    const reqBodyStr = JSON.stringify(ctx.body);
    const upstreamRequest = JSON.stringify({
      url: buildUpstreamUrl(provider.base_url, ctx.effectiveUpstreamPath),
      headers: sanitizeHeadersForLog(
        buildUpstreamHeaders(cliHdrs, apiKey, Buffer.byteLength(reqBodyStr), ctx.effectiveApiType as ApiType),
      ),
      body: reqBodyStr,
    });

    ctx.clientRequest = clientRequest;
    ctx.upstreamRequest = upstreamRequest;

    // 格式转换：流式 Transform + 非流式 response transform
    const needsTransform = ctx.metadata.get("needsTransform") as boolean;
    const formatTransform = needsTransform
      ? formatRegistry.createStreamTransform(
          provider.api_type as ApiType,
          ctx.apiType as ApiType,
          resolved.backend_model,
      )
      : undefined;
    if (formatTransform) {
      formatTransform.on("warning", (err: unknown) =>
        ctx.request.log.warn({ err, logId }, "formatTransform warning"),
      );
    }

    const responseTransform = needsTransform
      ? (bodyStr: string): string => {
        try {
          const parsed = JSON.parse(bodyStr) as Record<string, unknown>;
          if (parsed.type === "error" || parsed.error) {
            return formatRegistry.transformError(parsed, provider.api_type as ApiType, ctx.apiType as ApiType);
          }
          let transformed = formatRegistry.transformResponse(
            parsed,
              provider.api_type as ApiType,
              ctx.apiType as ApiType,
          );
          // Plugin 响应处理链（非流式）
          const pluginRegistry = container.resolve<PluginRegistry>(SERVICE_KEYS.pluginRegistry);
          if (pluginRegistry && !isStream) {
            try {
              const respCtx: ResponseTransformContext = {
                response: transformed,
                sourceApiType: provider.api_type as ApiType,
                targetApiType: ctx.apiType as ApiType,
                provider: { id: provider.id, name: provider.name, base_url: provider.base_url, api_type: provider.api_type } as PluginProviderInfo,
              };
              pluginRegistry.applyBeforeResponse(respCtx);
              pluginRegistry.applyAfterResponse(respCtx);
              transformed = respCtx.response;
            } catch (pluginErr) {
              ctx.request.log.debug({ err: pluginErr }, "plugin response hook failed");
            }
          }
          return JSON.stringify(transformed);
        } catch (err) {
          ctx.request.log.error({ err }, "responseTransform failed");
          return bodyStr;
        }
      }
      : undefined;

    // 构建 transport 函数
    const enhancementConfig = ctx.metadata.get("enhancementConfig") as EnhancementConfig;
    const cachedTargets = ctx.metadata.get("cachedTargets") as Target[];
    const isFailover = cachedTargets.length > 1;
    const concurrencyOverride = ctx.metadata.get("concurrencyOverride") as ConcurrencyOverride | undefined;
    const effectiveMappingReason = ctx.metadata.get("effectiveMappingReason") as MappingReason;

    const transportFn = buildTransportFn({
      provider,
      apiKey,
      body: ctx.body,
      cliHdrs,
      reply: ctx.reply,
      upstreamPath: ctx.effectiveUpstreamPath,
      apiType: ctx.effectiveApiType as "openai" | "openai-responses" | "anthropic",
      isStream,
      startTime,
      logId,
      effectiveModel: ctx.clientModel,
      streamTimeoutMs: getModelStreamTimeout(provider, resolved.backend_model),
      tracker,
      matcher,
      request: ctx.request,
      streamLoopEnabled: enhancementConfig.stream_loop_enabled,
      formatTransform,
      responseTransform,
      injectedHeaders: ctx.injectedHeaders,
      timeoutContext: { modelId: resolved.backend_model, providerId: provider.id },
      proxyAgentFactory,
    });

    // 通过 orchestrator 执行
    const resilienceResult = await orchestrator.handle(
      ctx.request,
      ctx.reply,
      clientApiType as "openai" | "openai-responses" | "anthropic",
      {
        resolved,
        provider,
        clientModel: ctx.clientModel,
        isStream,
        trackerId: logId,
        sessionId: ctx.metadata.get("session_id") as string | undefined,
        clientRequest,
        upstreamRequest,
        concurrencyOverride,
        mappingReason: effectiveMappingReason,
      },
      {
        retryBaseDelayMs,
        isFailover,
        ruleMatcher: matcher,
        transportFn,
      },
    );

    ctx.resilienceResult = resilienceResult;
    ctx.transportResult = resilienceResult.result;
  },
};

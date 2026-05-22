/**
 * pre_transport hook: API 格式转换 + upstream path 决策。
 *
 * 从 failover-loop.ts 的 resolveUpstreamPath + L206-210 提取。
 * 当 client api_type ≠ provider api_type 时，通过 FormatRegistry 执行
 * 请求体转换并确定上游路径；provider.upstream_path 具有最高优先级。
 */
import type { PipelineHook, PipelineContext } from "../../pipeline/types.js";
import { SERVICE_KEYS } from "../../../core/container.js";
import type { FormatRegistry } from "../../format/registry.js";
import type { ServiceContainer } from "../../../core/container.js";
import type { ApiType } from "../../transform/types.js";

export const formatTransformHook: PipelineHook = {
  name: "builtin:format-transform",
  phase: "pre_transport",
  priority: 0,
  core: true,
  execute(ctx: PipelineContext): void {
    const container = ctx.deps?.container ?? ctx.metadata.get("container") as ServiceContainer;
    const formatRegistry = container!.resolve<FormatRegistry>(SERVICE_KEYS.formatRegistry);
    const defaultUpstreamPath = ctx.deps?.defaultUpstreamPath ?? ctx.metadata.get("defaultUpstreamPath") as string ?? "";
    const provider = ctx.provider!;
    const clientApiType = ctx.apiType as ApiType;
    const providerApiType = provider.api_type as ApiType;

    const needsTransform = formatRegistry.needsTransform(clientApiType, providerApiType);
    let effectiveApiType: ApiType = clientApiType;
    let effectiveUpstreamPath = defaultUpstreamPath;

    if (needsTransform) {
      const transformed = formatRegistry.transformRequest(
        ctx.body,
        clientApiType,
        providerApiType,
        ctx.resolved!.backend_model,
      );
      ctx.body = transformed.body as Record<string, unknown>;
      effectiveUpstreamPath = transformed.upstreamPath;
      effectiveApiType = providerApiType;
    }

    // Provider 自定义 upstream_path 优先级最高
    if (provider.upstream_path) {
      effectiveUpstreamPath = provider.upstream_path;
    }

    ctx.effectiveApiType = effectiveApiType;
    ctx.effectiveUpstreamPath = effectiveUpstreamPath;
    // 保存 needsTransform 供 transport-execute hook 使用
    ctx.metadata.set("needsTransform", needsTransform);
  },
};

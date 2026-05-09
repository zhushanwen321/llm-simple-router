/**
 * pre_transport hook: Plugin registry 请求/响应变换。
 *
 * 在请求发送前，通过 PluginRegistry 对 body 和 headers 应用插件变换。
 *
 * 修改 ctx.body 和 ctx.injectedHeaders。
 *
 * 依赖：ctx.metadata 中需设置 "container"
 */
import { SERVICE_KEYS, type ServiceContainer } from "../../../core/container.js";
import type { PipelineHook, PipelineContext } from "../../pipeline/types.js";
import type { PluginRegistry } from "../../transform/plugin-registry.js";
import type { RequestTransformContext } from "../../transform/plugin-types.js";

export const pluginRequestHook: PipelineHook = {
  name: "builtin:plugin-request",
  phase: "pre_transport",
  priority: 250,
  execute(ctx: PipelineContext): void {
    const container = ctx.metadata.get("container") as ServiceContainer;
    if (!container) return;

    const pluginRegistry = container.resolve<PluginRegistry>(SERVICE_KEYS.pluginRegistry);
    if (!pluginRegistry) return;

    const { body, provider, injectedHeaders } = ctx;
    if (!provider) return;

    const pluginCtx: RequestTransformContext = {
      body,
      headers: { ...injectedHeaders },
      sourceApiType: ctx.apiType as "openai" | "openai-responses" | "anthropic",
      targetApiType: provider.api_type as "openai" | "openai-responses" | "anthropic",
      provider: {
        id: provider.id,
        name: provider.name,
        base_url: provider.base_url,
        api_type: provider.api_type,
      },
    };

    pluginRegistry.applyBeforeRequest(pluginCtx);
    pluginRegistry.applyAfterRequest(pluginCtx);

    // 用 plugin 变换后的 body 替换 ctx.body
    for (const key of Object.keys(ctx.body)) {
      delete ctx.body[key];
    }
    for (const [key, value] of Object.entries(pluginCtx.body)) {
      ctx.body[key] = value;
    }

    // 合并 injected headers
    ctx.injectedHeaders = pluginCtx.headers;
  },
};

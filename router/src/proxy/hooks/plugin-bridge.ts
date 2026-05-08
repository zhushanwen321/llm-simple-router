import type { PipelineHook, PipelineContext } from "../pipeline/types.js";
import type {
  TransformPlugin,
  RequestTransformContext,
  ResponseTransformContext,
  ErrorPluginContext,
} from "../transform/plugin-types.js";
import { pluginMatches } from "../transform/plugin-types.js";

/**
 * Register a TransformPlugin as PipelineHooks.
 * Each plugin method is wrapped in a separate hook at the appropriate phase.
 */
export function bridgePlugin(plugin: TransformPlugin): PipelineHook[] {
  const hooks: PipelineHook[] = [];

  // Request hooks → pre_transport phase
  if (plugin.beforeRequest || plugin.beforeRequestTransform) {
    hooks.push({
      name: `plugin:${plugin.name}:beforeRequest`,
      phase: "pre_transport",
      priority: 250,
      execute(ctx) {
        if (!ctx.provider || !pluginMatches(plugin, ctx.provider)) return;
        const pluginCtx: RequestTransformContext = {
          body: ctx.body,
          headers: ctx.injectedHeaders,
          sourceApiType: ctx.apiType as any,
          targetApiType: ctx.effectiveApiType as any,
          provider: ctx.provider,
        };
        if (plugin.beforeRequest) plugin.beforeRequest(pluginCtx);
        else if (plugin.beforeRequestTransform) plugin.beforeRequestTransform(pluginCtx);
        ctx.body = pluginCtx.body;
        ctx.injectedHeaders = pluginCtx.headers;
      },
    });
  }

  if (plugin.afterRequest || plugin.afterRequestTransform) {
    hooks.push({
      name: `plugin:${plugin.name}:afterRequest`,
      phase: "pre_transport",
      priority: 260,
      execute(ctx) {
        if (!ctx.provider || !pluginMatches(plugin, ctx.provider)) return;
        const pluginCtx: RequestTransformContext = {
          body: ctx.body,
          headers: ctx.injectedHeaders,
          sourceApiType: ctx.apiType as any,
          targetApiType: ctx.effectiveApiType as any,
          provider: ctx.provider,
        };
        if (plugin.afterRequest) plugin.afterRequest(pluginCtx);
        else if (plugin.afterRequestTransform) plugin.afterRequestTransform(pluginCtx);
        ctx.body = pluginCtx.body;
        ctx.injectedHeaders = pluginCtx.headers;
      },
    });
  }

  // Response hooks → post_response phase (non-stream only)
  if (plugin.beforeResponse || plugin.beforeResponseTransform) {
    hooks.push({
      name: `plugin:${plugin.name}:beforeResponse`,
      phase: "post_response",
      priority: 250,
      execute(ctx) {
        if (!ctx.provider || !pluginMatches(plugin, ctx.provider)) return;
        if (!ctx.transportResult || ctx.isStream) return;
        if (!("body" in ctx.transportResult)) return;
        try {
          const respObj = JSON.parse(ctx.transportResult.body);
          const pluginCtx: ResponseTransformContext = {
            response: respObj,
            sourceApiType: ctx.effectiveApiType as any,
            targetApiType: ctx.apiType as any,
            provider: ctx.provider,
          };
          if (plugin.beforeResponse) plugin.beforeResponse(pluginCtx);
          else if (plugin.beforeResponseTransform) plugin.beforeResponseTransform(pluginCtx);
          ctx.transportResult = { ...ctx.transportResult, body: JSON.stringify(pluginCtx.response) };
        } catch {
          /* best effort */
        }
      },
    });
  }

  if (plugin.afterResponse || plugin.afterResponseTransform) {
    hooks.push({
      name: `plugin:${plugin.name}:afterResponse`,
      phase: "post_response",
      priority: 260,
      execute(ctx) {
        if (!ctx.provider || !pluginMatches(plugin, ctx.provider)) return;
        if (!ctx.transportResult || ctx.isStream) return;
        if (!("body" in ctx.transportResult)) return;
        try {
          const respObj = JSON.parse(ctx.transportResult.body);
          const pluginCtx: ResponseTransformContext = {
            response: respObj,
            sourceApiType: ctx.effectiveApiType as any,
            targetApiType: ctx.apiType as any,
            provider: ctx.provider,
          };
          if (plugin.afterResponse) plugin.afterResponse(pluginCtx);
          else if (plugin.afterResponseTransform) plugin.afterResponseTransform(pluginCtx);
          ctx.transportResult = { ...ctx.transportResult, body: JSON.stringify(pluginCtx.response) };
        } catch {
          /* best effort */
        }
      },
    });
  }

  // Error hook → on_error phase
  if (plugin.onError) {
    hooks.push({
      name: `plugin:${plugin.name}:onError`,
      phase: "on_error",
      priority: 250,
      execute(ctx) {
        const err = ctx.metadata.get("error") as Error | undefined;
        const statusCode = ctx.metadata.get("errorStatusCode") as number | undefined;
        if (!err || !ctx.provider) return;
        plugin.onError!({
          error: err,
          statusCode,
          provider: ctx.provider,
          providerId: ctx.provider.id,
        } satisfies ErrorPluginContext);
      },
    });
  }

  return hooks;
}

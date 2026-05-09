import type { PipelineContext, PipelineHook } from "../pipeline/types.js";
import type {
  TransformPlugin,
  RequestTransformContext,
  ResponseTransformContext,
  ErrorPluginContext,
} from "../transform/plugin-types.js";
import { pluginMatches } from "../transform/plugin-types.js";

type ApiType = "openai" | "openai-responses" | "anthropic";

/** Apply a request-phase plugin method (beforeRequest/afterRequest) to the pipeline context */
function applyRequestTransform(
  plugin: TransformPlugin,
  ctx: PipelineContext,
  primary: "beforeRequest" | "afterRequest",
  legacy: "beforeRequestTransform" | "afterRequestTransform",
): void {
  if (!ctx.provider || !pluginMatches(plugin, ctx.provider)) return;
  const pluginCtx: RequestTransformContext = {
    body: ctx.body,
    headers: ctx.injectedHeaders,
    sourceApiType: ctx.apiType as ApiType,
    targetApiType: ctx.effectiveApiType as ApiType,
    provider: ctx.provider,
  };
  const fn = plugin[primary] ?? plugin[legacy];
  if (fn) fn(pluginCtx);
  ctx.body = pluginCtx.body;
  ctx.injectedHeaders = pluginCtx.headers;
}

/** Apply a response-phase plugin method (beforeResponse/afterResponse) to the pipeline context */
function applyResponseTransform(
  plugin: TransformPlugin,
  ctx: PipelineContext,
  primary: "beforeResponse" | "afterResponse",
  legacy: "beforeResponseTransform" | "afterResponseTransform",
): void {
  if (!ctx.provider || !pluginMatches(plugin, ctx.provider)) return;
  if (!ctx.transportResult || ctx.isStream) return;
  if (!("body" in ctx.transportResult)) return;
  try {
    const respObj = JSON.parse(ctx.transportResult.body);
    const pluginCtx: ResponseTransformContext = {
      response: respObj,
      sourceApiType: ctx.effectiveApiType as ApiType,
      targetApiType: ctx.apiType as ApiType,
      provider: ctx.provider,
    };
    const fn = plugin[primary] ?? plugin[legacy];
    if (fn) fn(pluginCtx);
    ctx.transportResult = { ...ctx.transportResult, body: JSON.stringify(pluginCtx.response) };
  } catch (e) {
    ctx.request.log.warn({ err: e }, 'plugin response hook failed');
  }
}

/**
 * Bridge a TransformPlugin into PipelineHooks.
 * Each plugin method becomes a separate hook at the appropriate phase.
 */
export function bridgePlugin(plugin: TransformPlugin): PipelineHook[] {
  const hooks: PipelineHook[] = [];

  // Request hooks → pre_transport phase
  if (plugin.beforeRequest || plugin.beforeRequestTransform) {
    hooks.push({
      name: `plugin:${plugin.name}:beforeRequest`,
      phase: "pre_transport",
      priority: 250,
      execute(ctx) { applyRequestTransform(plugin, ctx, "beforeRequest", "beforeRequestTransform"); },
    });
  }

  if (plugin.afterRequest || plugin.afterRequestTransform) {
    hooks.push({
      name: `plugin:${plugin.name}:afterRequest`,
      phase: "pre_transport",
      priority: 260,
      execute(ctx) { applyRequestTransform(plugin, ctx, "afterRequest", "afterRequestTransform"); },
    });
  }

  // Response hooks → post_response phase (non-stream only)
  if (plugin.beforeResponse || plugin.beforeResponseTransform) {
    hooks.push({
      name: `plugin:${plugin.name}:beforeResponse`,
      phase: "post_response",
      priority: 250,
      execute(ctx) { applyResponseTransform(plugin, ctx, "beforeResponse", "beforeResponseTransform"); },
    });
  }

  if (plugin.afterResponse || plugin.afterResponseTransform) {
    hooks.push({
      name: `plugin:${plugin.name}:afterResponse`,
      phase: "post_response",
      priority: 260,
      execute(ctx) { applyResponseTransform(plugin, ctx, "afterResponse", "afterResponseTransform"); },
    });
  }

  // Error hook → on_error phase
  if (plugin.onError) {
    const onError = plugin.onError;
    hooks.push({
      name: `plugin:${plugin.name}:onError`,
      phase: "on_error",
      priority: 250,
      execute(ctx) {
        const err = ctx.metadata.get("error") as Error | undefined;
        const statusCode = ctx.metadata.get("errorStatusCode") as number | undefined;
        if (!err || !ctx.provider || !pluginMatches(plugin, ctx.provider)) return;
        onError({
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

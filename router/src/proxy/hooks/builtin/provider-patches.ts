/**
 * pre_transport hook: Provider 自定义补丁。
 *
 * 在请求发送前，根据 provider 配置应用 body 补丁
 *（developer_role 转换、DeepSeek 补丁等）。
 *
 * 修改 ctx.body。
 *
 * 依赖：ctx.resolved 和 ctx.provider 必须已填充。
 */
import { parseModels } from "../../../config/model-context.js";
import { applyProviderPatches } from "../../patch/index.js";
import type { PipelineHook, PipelineContext } from "../../pipeline/types.js";

export const providerPatchesHook: PipelineHook = {
  name: "builtin:provider-patches",
  phase: "pre_transport",
  priority: 100,
  execute(ctx: PipelineContext): void {
    const { body, provider } = ctx;
    if (!provider) return;

    const providerModels = parseModels(provider.models || "[]");
    const { body: patchedBody, meta: patchMeta } = applyProviderPatches(body, {
      base_url: provider.base_url,
      api_type: provider.api_type,
      models: providerModels,
    });

    // 用 patch 结果替换 ctx.body
    for (const key of Object.keys(ctx.body)) {
      delete ctx.body[key];
    }
    for (const [key, value] of Object.entries(patchedBody)) {
      ctx.body[key] = value;
    }

    ctx.snapshot.add({ stage: "provider_patch", types: patchMeta.types });
  },
};

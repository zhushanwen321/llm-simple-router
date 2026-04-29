import { applyDeepSeekPatches } from "./deepseek/index.js";
import { patchRouterSyntheticToolCalls } from "./router-cleanup.js";

interface ProviderInfo {
  base_url: string;
}

export interface ProviderPatchMeta {
  types: string[];
}

/**
 * 通用消息补丁入口。
 * 返回新的 body（必要时深拷贝），不修改原始 body。
 * 执行顺序：
 * 1. 清理 router 合成的 tool_use/tool_result（通用，所有 provider）
 * 2. Provider-specific patches（如 DeepSeek thinking 校验）
 */
export function applyProviderPatches(
  body: Record<string, unknown>,
  provider: ProviderInfo,
): { body: Record<string, unknown>; meta: ProviderPatchMeta } {
  // router cleanup 始终执行，先克隆以避免修改原始 body
  const cloned = JSON.parse(JSON.stringify(body));
  patchRouterSyntheticToolCalls(cloned);

  if (!needsDeepSeekPatch(body, provider)) {
    return { body: cloned, meta: { types: [] } };
  }
  applyDeepSeekPatches(cloned);
  return { body: cloned, meta: { types: ["deepseek_tool_use_to_text"] } };
}

/** DeepSeek patch 触发条件：直连 DeepSeek，或经代理转发且模型名含 deepseek */
function needsDeepSeekPatch(body: Record<string, unknown>, provider: ProviderInfo): boolean {
  if (provider.base_url.includes("deepseek")) return true;
  const model = (body.model as string) ?? "";
  return model.includes("deepseek");
}

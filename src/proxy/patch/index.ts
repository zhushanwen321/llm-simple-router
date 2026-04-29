import { applyDeepSeekPatches } from "./deepseek/index.js";
import { patchRouterSyntheticToolCalls } from "./router-cleanup.js";

interface ProviderInfo {
  base_url: string;
}

/**
 * 通用消息补丁入口。
 * 执行顺序：
 * 1. 清理 router 合成的 tool_use/tool_result（通用，所有 provider）
 * 2. Provider-specific patches（如 DeepSeek thinking 校验）
 */
export function applyProviderPatches(
  body: Record<string, unknown>,
  provider: ProviderInfo,
): void {
  patchRouterSyntheticToolCalls(body);
  if (needsDeepSeekPatch(body, provider)) {
    applyDeepSeekPatches(body);
  }
}

/** DeepSeek patch 触发条件：直连 DeepSeek，或经代理转发且模型名含 deepseek */
function needsDeepSeekPatch(body: Record<string, unknown>, provider: ProviderInfo): boolean {
  if (provider.base_url.includes("deepseek")) return true;
  const model = (body.model as string) ?? "";
  return model.includes("deepseek");
}

import { applyDeepSeekPatches } from "./deepseek/index.js";

interface ProviderInfo {
  base_url: string;
}

export interface ProviderPatchMeta {
  types: string[];
}

/**
 * 根据 provider 信息分发到对应的补丁逻辑。
 * 返回浅拷贝 body + 执行的补丁类型列表，不修改原始 body。
 */
export function applyProviderPatches(
  body: Record<string, unknown>,
  provider: ProviderInfo,
): { body: Record<string, unknown>; meta: ProviderPatchMeta } {
  if (needsDeepSeekPatch(body, provider)) {
    const cloned = JSON.parse(JSON.stringify(body));
    applyDeepSeekPatches(cloned);
    return { body: cloned, meta: { types: ["deepseek"] } };
  }
  return { body, meta: { types: [] } };
}

/** DeepSeek patch 触发条件：直连 DeepSeek，或经代理转发且模型名含 deepseek */
function needsDeepSeekPatch(body: Record<string, unknown>, provider: ProviderInfo): boolean {
  if (provider.base_url.includes("deepseek")) return true;
  const model = (body.model as string) ?? "";
  return model.includes("deepseek");
}

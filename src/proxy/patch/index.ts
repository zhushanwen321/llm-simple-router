import { applyDeepSeekPatches } from "./deepseek/index.js";

interface ProviderInfo {
  base_url: string;
}

/**
 * 根据 provider 信息分发到对应的补丁逻辑。
 * 每个补丁直接修改 body，不返回新对象。
 */
export function applyProviderPatches(
  body: Record<string, unknown>,
  provider: ProviderInfo,
): void {
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

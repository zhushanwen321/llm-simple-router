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
  if (provider.base_url.includes("deepseek")) {
    applyDeepSeekPatches(body);
  }
}

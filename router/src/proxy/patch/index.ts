import type { ModelEntry } from "../../config/model-context.js";
import { applyDeepSeekPatches } from "./deepseek/index.js";

export interface ProviderInfo {
  base_url: string;
  api_type: string;
  models?: ModelEntry[];
}

export interface ProviderPatchMeta {
  types: string[];
}

const OPENAI_ORIGIN_HOSTS = ["api.openai.com", "openai.com"];

/**
 * 根据 provider 信息分发到对应的补丁逻辑。
 * 优先使用 DB 配置的 patches 模式，无配置时回退到自动检测。
 * 返回浅拷贝 body + 执行的补丁类型列表，不修改原始 body。
 */
export function applyProviderPatches(
  body: Record<string, unknown>,
  provider: ProviderInfo,
): { body: Record<string, unknown>; meta: ProviderPatchMeta } {
  const patches: string[] = [];
  let cloned = false;
  let patched: Record<string, unknown> | undefined;

  const ensureCloned = (): Record<string, unknown> => {
    if (!cloned) {
      patched = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
      cloned = true;
    }
    return patched!;
  };

  // ---- DB-driven mode：通过 provider.models 配置的 patches 驱动 ----
  if (provider.models) {
    const modelName = (body.model as string) ?? "";
    const modelEntry = provider.models.find(m => m.name === modelName);
    const modelPatches = modelEntry?.patches ?? [];

    if (modelPatches.length > 0) {
      // developer_role 补丁（仅 openai 格式需要）
      if (modelPatches.includes("developer_role") && provider.api_type === "openai" && hasDeveloperRole(body)) {
        patchDeveloperRole(ensureCloned());
        patches.push("developer_role");
      }

      // DeepSeek Anthropic 补丁
      const dsAnthropicPatches = ["thinking-param", "cache-control", "thinking-blocks", "orphan-tool-results"];
      if (dsAnthropicPatches.some(p => modelPatches.includes(p)) && provider.api_type === "anthropic") {
        applyDeepSeekPatches(ensureCloned(), "anthropic");
        patches.push("deepseek");
      }

      // DeepSeek OpenAI 补丁
      const dsOpenAIPatches = ["non-ds-tools", "orphan-tool-results-oa"];
      if (dsOpenAIPatches.some(p => modelPatches.includes(p)) && provider.api_type === "openai") {
        applyDeepSeekPatches(ensureCloned(), "openai");
        patches.push("deepseek");
      }

      return { body: patched ?? body, meta: { types: patches } };
    }
  }

  // ---- 回退模式：自动检测（保持现有逻辑不变）----
  // 通用补丁：OpenAI 兼容 provider（非 OpenAI 原生）不支持 developer role
  if (provider.api_type === "openai" && !isOpenAIOrigin(provider.base_url)) {
    if (hasDeveloperRole(body)) {
      patchDeveloperRole(ensureCloned());
      patches.push("developer_role");
    }
  }

  // DeepSeek 特定补丁
  if (needsDeepSeekPatch(body, provider)) {
    applyDeepSeekPatches(ensureCloned(), provider.api_type as "openai" | "openai-responses" | "anthropic");
    patches.push("deepseek");
  }

  return { body: patched ?? body, meta: { types: patches } };
}

/** 判断是否为 OpenAI 官方端点 */
function isOpenAIOrigin(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return OPENAI_ORIGIN_HOSTS.some(origin => host === origin || host.endsWith(`.${origin}`));
  } catch {
    return false;
  }
}

/** 检查 messages 中是否包含 developer role */
function hasDeveloperRole(body: Record<string, unknown>): boolean {
  const messages = body.messages as Array<Record<string, unknown>> | undefined;
  if (!messages) return false;
  return messages.some(m => m.role === "developer");
}

/** 将 developer role 转换为 system */
function patchDeveloperRole(body: Record<string, unknown>): void {
  const messages = body.messages as Array<Record<string, unknown>> | undefined;
  if (!messages) return;
  for (const msg of messages) {
    if (msg.role === "developer") {
      msg.role = "system";
    }
  }
}

/** DeepSeek patch 触发条件：直连 DeepSeek，或经代理转发且模型名含 deepseek */
function needsDeepSeekPatch(body: Record<string, unknown>, provider: ProviderInfo): boolean {
  if (provider.base_url.includes("deepseek")) return true;
  const model = (body.model as string) ?? "";
  return model.includes("deepseek");
}

import type { Provider } from "@/types/mapping";
import type {
  ProviderGroup,
  ModelOption,
} from "@/components/mappings/cascading-types";
import { DEFAULT_CONTEXT_WINDOW } from "@/constants";

export interface ToProviderGroupsOptions {
  /** 仅包含激活的 Provider，默认 false */
  activeOnly?: boolean;
  /** 是否包含 streamTimeoutMs 字段，默认 true */
  includeStreamTimeout?: boolean;
  /** 默认 context window 值，默认 DEFAULT_CONTEXT_WINDOW (200000) */
  defaultContextWindow?: number;
}

/**
 * 将 Provider[] 统一转换为 ProviderGroup[]（映射选择器所需格式）。
 * 消除 ModelMappings / ProxyEnhancement / Schedules 三处的重复转换逻辑。
 */
export function toProviderGroups(
  providers: Provider[],
  options?: ToProviderGroupsOptions,
): ProviderGroup[] {
  const {
    activeOnly = false,
    includeStreamTimeout = true,
    defaultContextWindow = DEFAULT_CONTEXT_WINDOW,
  } = options ?? {};

  const filtered = activeOnly
    ? providers.filter((p) => p.is_active)
    : providers;

  return filtered.map((p) => ({
    provider: { id: p.id, name: p.name },
    models: (p.models ?? []).map((m) => {
      const model: ModelOption = {
        name: m.name,
        contextWindow: m.context_window ?? defaultContextWindow,
      };
      if (includeStreamTimeout) {
        model.streamTimeoutMs = m.stream_timeout_ms ?? null;
      }
      return model;
    }),
  }));
}

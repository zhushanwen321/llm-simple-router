/**
 * Mapping 领域解析层 — 封装 mapping group rule 的 JSON parse/serialize 逻辑。
 * ModelMappings.vue 的 UI 层只调用此模块的纯函数，不直接接触 JSON.parse/stringify。
 */
import type {
  MappingTarget,
  MultimodalFallback,
  Provider,
  Rule,
} from "@/types/mapping";

// ─── 常量 ───────────────────────────────────────────────

/** summaryText 中 provider name 的截断长度 */
export const PROVIDER_NAME_TRUNCATE = 6;

// ─── 类型 ───────────────────────────────────────────────

/** context overflow 目标（从 MappingTarget 的 overflow_* 字段提取） */
export interface OverflowTarget {
  provider_id: string;
  model: string;
}

/** parseMappingRule 的完整解析结果 */
export interface ParsedRule {
  targets: MappingTarget[];
  overflow: OverflowTarget | null;
  multimodal: MultimodalFallback | null;
}

/** parseMappingRule 的返回值（含错误标记） */
export interface ParseRuleResult {
  data: ParsedRule;
  parseError: boolean;
}

// ─── 解析（DB → 编辑状态）────────────────────────────────

/**
 * 解析 mapping group 的 rule JSON 字符串。
 * 纯函数，不依赖 Vue reactivity，不产生 UI 副作用。
 *
 * 兼容旧版 default 格式：若 JSON 含 default 但无 targets，
 * 自动将 default 包装为 targets 数组的第一个元素。
 *
 * @param ruleJson - mapping_group.rule 字段的原始 JSON 字符串
 * @param fallbackProviderId - targets 为空时的默认 provider_id
 * @returns { data, parseError } — parseError=true 表示 JSON 解析失败（数据已回退到默认值）
 */
export function parseMappingRule(
  ruleJson: string,
  fallbackProviderId: string,
): ParseRuleResult {
  let rule: Rule = {};
  let parseError = false;

  try {
    const parsed = JSON.parse(ruleJson) as Record<string, unknown>;
    rule =
      parsed.default && !parsed.targets
        ? { targets: [parsed.default as MappingTarget] }
        : (parsed as Rule);
  } catch {
    parseError = true;
  }

  const targets: MappingTarget[] = (rule.targets ?? []).map((tgt) => ({
    backend_model: tgt.backend_model || "",
    provider_id: tgt.provider_id || "",
    overflow_provider_id: tgt.overflow_provider_id,
    overflow_model: tgt.overflow_model,
    // 透传熔断配置：白名单缺此字段会导致加载即丢弃，编辑保存后配置静默消失
    circuit_breaker: tgt.circuit_breaker,
  }));

  const firstTarget = targets[0];
  const overflow: OverflowTarget | null =
    firstTarget?.overflow_provider_id && firstTarget?.overflow_model
      ? {
        provider_id: firstTarget.overflow_provider_id,
        model: firstTarget.overflow_model,
      }
      : null;

  const multimodal = rule.multimodal_fallback ?? null;

  return {
    data: {
      targets:
        targets.length > 0
          ? targets
          : [{ backend_model: "", provider_id: fallbackProviderId }],
      overflow,
      multimodal,
    },
    parseError,
  };
}

// ─── 序列化（编辑状态 → API payload）─────────────────────

/**
 * 将编辑状态序列化为 rule JSON 字符串。
 * 纯函数，不依赖 Vue reactivity。
 *
 * overflow 信息嵌入到 targets[0] 的 overflow_provider_id / overflow_model 字段。
 * multimodal_fallback 作为顶层字段。
 */
export function serializeRule(
  targets: MappingTarget[],
  overflow: OverflowTarget | null,
  multimodal: MultimodalFallback | null,
): string {
  const serializedTargets = targets.map((tgt, idx) => ({
    backend_model: tgt.backend_model,
    provider_id: tgt.provider_id,
    ...(idx === 0 && overflow
      ? {
        overflow_provider_id: overflow.provider_id,
        overflow_model: overflow.model,
      }
      : {}),
    // 有配置才写入，无配置不出现字段（向后兼容）
    ...(tgt.circuit_breaker ? { circuit_breaker: tgt.circuit_breaker } : {}),
  }));

  return JSON.stringify({
    targets: serializedTargets,
    ...(multimodal ? { multimodal_fallback: multimodal } : {}),
  });
}

// ─── 摘要文本 ───────────────────────────────────────────

/**
 * 构建 mapping group 在左侧列表中的摘要文本。
 * 纯函数，不依赖 Vue reactivity。
 *
 * 格式：ProviderA → ProviderB → ↓ OverflowProv → MM
 */
export function buildSummaryText(
  ruleJson: string,
  providers: Provider[],
  fallbackProviderId: string,
): string {
  const { data } = parseMappingRule(ruleJson, fallbackProviderId);
  const parts: string[] = [];

  for (const tgt of data.targets) {
    const prov = providers.find((p) => p.id === tgt.provider_id);
    const provName =
      prov?.name ?? tgt.provider_id.slice(0, PROVIDER_NAME_TRUNCATE);
    parts.push(provName);
  }

  if (data.overflow) {
    const prov = providers.find((p) => p.id === data.overflow!.provider_id);
    parts.push("↓ " + (prov?.name ?? "OF"));
  }

  if (data.multimodal) {
    parts.push("MM");
  }

  return parts.join(" → ");
}

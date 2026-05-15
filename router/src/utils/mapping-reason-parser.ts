const KNOWN_MAPPING_REASONS = new Set([
  "direct_format",
  "group_base_rule",
  "group_schedule",
  "fallback_provider",
  "overflow_redirect",
  "failover_retry",
]);

/**
 * 从 pipeline_snapshot JSON 中提取映射原因。
 * 优先检查 overflow stage（triggered === true → "overflow_redirect"），
 * 否则取 routing stage 的 mapping_reason 字段。
 * 只返回白名单中的值，避免未知的 mapping_reason 导致 i18n key 断裂。
 */
export function parseMappingReason(
  snapshot: string | null | undefined,
): string | undefined {
  if (!snapshot) return undefined;
  try {
    const parsed: unknown = JSON.parse(snapshot);
    const stages: Array<Record<string, unknown>> = Array.isArray(parsed)
      ? parsed
      : [];
    if (stages.length === 0) return undefined;
    for (const stage of stages) {
      if (stage.stage === "overflow" && stage.triggered === true) {
        return "overflow_redirect";
      }
    }
    for (const stage of stages) {
      if (
        stage.stage === "routing" &&
    typeof stage.mapping_reason === "string"
      ) {
        return KNOWN_MAPPING_REASONS.has(stage.mapping_reason)
          ? stage.mapping_reason
          : undefined;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

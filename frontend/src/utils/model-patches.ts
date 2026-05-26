export type ApiFormat = "openai" | "openai-responses" | "anthropic";

/** 根据模型名称和 API 格式计算默认 patches */
export function computeDefaultPatches(
  modelName: string,
  format: ApiFormat,
  isNonOpenaiEndpoint: boolean,
): string[] {
  const patches: string[] = [];
  const isDeepseek = modelName.toLowerCase().includes("deepseek");
  if (isDeepseek) {
    patches.push("thinking_consistency");
    if (format === "anthropic") {
      patches.push("orphan_tool_results");
    } else {
      patches.push("orphan_tool_results_oa");
    }
  }
  if (format === "openai" && isNonOpenaiEndpoint) {
    patches.push("developer_role");
  }
  return patches;
}

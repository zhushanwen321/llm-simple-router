import { patchThinkingConsistency } from "./patch-thinking.js";
import { patchOrphanToolResults, patchOrphanToolResultsOA } from "./patch-orphan-tool-results.js";

/**
 * 按序执行所有 DeepSeek 特定补丁。
 *
 * Patch 在格式转换之后执行，body 已经是 provider 的 api_type 格式。
 * thinking-consistency 是统一的 thinking 一致性处理，内部按 apiType 自动分发。
 */
export function applyDeepSeekPatches(
  body: Record<string, unknown>,
  apiType: "openai" | "openai-responses" | "anthropic",
): void {
  patchThinkingConsistency(body, apiType);

  if (apiType === "anthropic") {
    patchOrphanToolResults(body);
  } else {
    patchOrphanToolResultsOA(body);
  }
}

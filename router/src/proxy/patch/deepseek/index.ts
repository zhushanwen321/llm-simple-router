import { patchThinkingParam } from "./patch-thinking-param.js";
import { stripCacheControl } from "./patch-cache-control.js";
import { patchMissingThinkingBlocks } from "./patch-thinking-blocks.js";
import { patchNonDeepSeekToolMessages } from "./patch-non-deepseek-tools.js";
import { patchOrphanToolResults, patchOrphanToolResultsOA } from "./patch-orphan-tool-results.js";

/**
 * 按序执行所有 DeepSeek 特定补丁。
 *
 * Patch 在格式转换之后执行，body 已经是 provider 的 api_type 格式。
 * DeepSeek 的 api_type 为 openai，但 Anthropic 端点也受支持，
 * 因此按 apiType 分发不同的 patch 流程。
 *
 * Anthropic 格式执行顺序：
 *   1. patchThinkingParam — 注入 thinking 参数
 *   2. stripCacheControl — 剥离 cache_control
 *   3. patchMissingThinkingBlocks — 补 thinking block
 *   4. patchOrphanToolResults — 清理孤儿 tool_result
 *
 * OpenAI 格式执行顺序（参考 docs/deepseek-patch-investigation.md §5.5）：
 *   1. patchThinkingParam — 检测历史 reasoning_content，注入 thinking 参数
 *   2. patchNonDeepSeekToolMessages — 将非 DeepSeek 生成的 tool_calls 降级为 text
 *   3. patchOrphanToolResultsOA — 处理孤儿 tool 消息
 */
export function applyDeepSeekPatches(
  body: Record<string, unknown>,
  apiType: "openai" | "openai-responses" | "anthropic",
): void {
  if (apiType === "anthropic") {
    patchThinkingParam(body, apiType);
    stripCacheControl(body);
    patchMissingThinkingBlocks(body);
    patchOrphanToolResults(body);
  } else {
    patchThinkingParam(body, apiType);
    patchNonDeepSeekToolMessages(body);
    patchOrphanToolResultsOA(body);
  }
}

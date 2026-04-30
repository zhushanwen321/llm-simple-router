import { patchThinkingParam } from "./patch-thinking-param.js";
import { stripCacheControl } from "./patch-cache-control.js";
import { patchMissingThinkingBlocks } from "./patch-thinking-blocks.js";
import { patchOrphanToolResults } from "./patch-orphan-tool-results.js";

/**
 * 按序执行所有 DeepSeek 特定补丁。
 *
 * 执行顺序依赖：
 * 1. patchThinkingParam — 注入 thinking 参数，后续 patch 依赖 body.thinking 存在
 * 2. stripCacheControl — 剥离 cache_control，在消息结构修改前执行
 * 3. patchMissingThinkingBlocks — 给空 assistant 补 thinking block，防止被 orphan 清理误删
 * 4. patchOrphanToolResults — 清理孤儿/空消息/去重，必须在最后执行
 */
export function applyDeepSeekPatches(
  body: Record<string, unknown>,
  apiType: "openai" | "anthropic",
): void {
  if (apiType === "anthropic") {
    patchThinkingParam(body, apiType);
    stripCacheControl(body);
    patchMissingThinkingBlocks(body);
    patchOrphanToolResults(body);
  }
  // OpenAI patch 留给后续 PR
}

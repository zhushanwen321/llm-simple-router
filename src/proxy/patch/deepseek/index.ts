import { patchMissingThinkingBlocks } from "./patch-thinking-blocks.js";
import { patchOrphanToolResults } from "./patch-orphan-tool-results.js";

/**
 * 按序执行所有 DeepSeek 特定补丁。
 * thinking 补丁先执行（影响 assistant 消息结构），
 * tool_result 配对修复后执行。
 */
export function applyDeepSeekPatches(body: Record<string, unknown>): void {
  patchMissingThinkingBlocks(body);
  patchOrphanToolResults(body);
}

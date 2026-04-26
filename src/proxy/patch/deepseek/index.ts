import { patchMissingThinkingBlocks } from "./patch-thinking-blocks.js";
import { patchOrphanToolResults } from "./patch-orphan-tool-results.js";
import { patchToolsFormat } from "./patch-tools-format.js";

/**
 * 按序执行所有 DeepSeek 特定补丁。
 * tools 格式转换最先执行（影响上游能否接受请求），
 * thinking 补丁其次（影响 assistant 消息结构），
 * tool_result 配对修复最后执行。
 */
export function applyDeepSeekPatches(body: Record<string, unknown>): void {
  patchToolsFormat(body);
  patchMissingThinkingBlocks(body);
  patchOrphanToolResults(body);
}

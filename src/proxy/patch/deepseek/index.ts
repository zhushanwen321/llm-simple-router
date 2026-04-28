import { patchNonDeepSeekToolMessages } from "./patch-thinking-blocks.js";
import { patchOrphanToolResults } from "./patch-orphan-tool-results.js";

/**
 * 按序执行所有 DeepSeek 特定补丁。
 * 非 DeepSeek tool 消息补丁先执行（转换 tool_use/tool_result），
 * tool_result 配对修复后执行。
 */
export function applyDeepSeekPatches(body: Record<string, unknown>): void {
  patchNonDeepSeekToolMessages(body);
  patchOrphanToolResults(body);
}

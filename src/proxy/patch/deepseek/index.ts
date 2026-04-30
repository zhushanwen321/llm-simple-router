import { patchNonDeepSeekToolMessages } from "./patch-non-deepseek-tools.js";
import { patchOrphanToolResults } from "./patch-orphan-tool-results.js";

/**
 * 按序执行所有 DeepSeek 特定补丁。
 *
 * 所有补丁基于 OpenAI 格式设计（因为 patch 在格式转换之后执行，
 * body 此时已是 provider 的 api_type 格式，DeepSeek 为 openai）。
 *
 * 执行顺序（参考 docs/deepseek-patch-investigation.md §5.5）：
 * 1. patchNonDeepSeekToolMessages — 将非 DeepSeek 生成的 tool_calls 降级为 text
 * 2. patchOrphanToolResults — 处理上下文截断产生的孤儿 tool 消息
 */
export function applyDeepSeekPatches(body: Record<string, unknown>): void {
  patchNonDeepSeekToolMessages(body);
  patchOrphanToolResults(body);
}

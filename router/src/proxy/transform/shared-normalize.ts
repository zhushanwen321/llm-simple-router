import type { ResponseInputItem, ResponseInputMessage } from "./types-responses.js";

/**
 * Codex CLI 省略 input item 的 type 字段（如 `{role:"user", content:"..."}`），
 * OpenAI 官方端点静默容忍，但按 discriminated union 匹配 type 时会跳过这些 item。
 * 补全缺失的 type 字段：有 role 但无 type 时视为 "message"。
 */
export function normalizeInputTypes(input: ResponseInputItem[]): ResponseInputItem[] {
  return input.map(item => {
    const obj = item as unknown as Record<string, unknown>;
    if (!obj.type && "role" in obj) {
      return { ...obj, type: "message" } as ResponseInputMessage;
    }
    return item;
  });
}

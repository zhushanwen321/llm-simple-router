/** 格式转换方向 */
export type TransformDirection =
  // 现有
  | "openai-to-anthropic" | "anthropic-to-openai"
  // 一级：Responses ↔ Anthropic
  | "openai-responses-to-anthropic" | "anthropic-to-openai-responses"
  // 二级：Responses ↔ Chat
  | "openai-to-openai-responses" | "openai-responses-to-openai";

/** 所有支持的 API 格式类型 */
export type ApiType = "openai" | "openai-responses" | "anthropic";

// ---------- Anthropic Content Block 类型 ----------

export interface AnthropicTextBlock { type: "text"; text: string; }
export interface AnthropicThinkingBlock { type: "thinking"; thinking: string; }
export interface AnthropicToolUseBlock { type: "tool_use"; id: string; name: string; input: Record<string, unknown>; }
export interface AnthropicToolResultBlock { type: "tool_result"; tool_use_id: string; content: string; }
export interface AnthropicImageBlock {
  type: "image";
  source: { type: "url" | "base64"; url?: string; media_type?: string; data?: string };
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicThinkingBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicImageBlock;

// ---------- OpenAI 类型 ----------

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

// ---------- 转换结果 ----------

export interface TransformResult {
  body: Record<string, unknown>;
  upstreamPath: string;
}

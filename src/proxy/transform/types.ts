/** 格式转换方向 */
export type TransformDirection = "openai-to-anthropic" | "anthropic-to-openai";

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

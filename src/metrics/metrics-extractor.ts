import { MS_PER_SECOND } from "../constants.js";
import { encode } from "gpt-tokenizer";
import type { SSEEvent } from "./sse-parser.js";

export interface MetricsResult {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
  ttft_ms: number | null;
  total_duration_ms: number | null;
  tokens_per_second: number | null;
  stop_reason: string | null;
  is_complete: number;
}

interface AnthropicMessageStart {
  type: string;
  message?: {
    usage?: {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

interface AnthropicContentBlockDelta {
  type: string;
  delta?: { type: string; text?: string; thinking?: string };
}

interface AnthropicMessageDelta {
  type: string;
  delta?: { stop_reason?: string };
  usage?: { output_tokens?: number; input_tokens?: number };
}

interface OpenAIChoice {
  delta?: { role?: string; content?: string };
  finish_reason?: string;
}

interface OpenAIStreamChunk {
  choices?: OpenAIChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

export class MetricsExtractor {
  private inputTokens: number | null = null;
  private outputTokens: number | null = null;
  private cacheCreationTokens: number | null = null;
  private cacheReadTokens: number | null = null;
  private ttftMs: number | null = null;
  private streamStartTime: number | null = null;
  private streamEndTime: number | null = null;
  private stopReason: string | null = null;
  private firstContentReceived = false;
  private complete = false;

  // Thinking model tracking: separate thinking vs text content for accurate TPS
  private hasThinkingContent = false;
  private textContentBuffer = "";
  private textStreamStartTime: number | null = null;

  constructor(
    private apiType: "openai" | "anthropic",
    private requestStartTime: number,
  ) {}

  processEvent(event: SSEEvent): void {
    if (!event.data) return;

    if (this.apiType === "anthropic") {
      this.processAnthropicEvent(event);
    } else {
      this.processOpenAIEvent(event);
    }
  }

  getMetrics(): MetricsResult {
    let totalDurationMs: number | null = null;
    let tokensPerSecond: number | null = null;

    if (
      this.streamStartTime !== null &&
      this.streamEndTime !== null &&
      this.outputTokens !== null
    ) {
      totalDurationMs = this.streamEndTime - this.streamStartTime;

      if (this.hasThinkingContent) {
        // Thinking model: output_tokens includes thinking + text tokens.
        // Use gpt-tokenizer to count actual text-only tokens from the
        // streamed text content, avoiding chars-to-token estimation errors.
        if (this.textContentBuffer.length > 0 && this.textStreamStartTime !== null) {
          const textTokens = encode(this.textContentBuffer).length;
          const textDurationMs = this.streamEndTime - this.textStreamStartTime;
          if (textTokens > 0 && textDurationMs > 0) {
            tokensPerSecond = textTokens / (textDurationMs / MS_PER_SECOND);
          }
        }
        // No text content → TPS remains null (can't measure visible output speed)
      } else if (totalDurationMs > 0) {
        tokensPerSecond =
          this.outputTokens / (totalDurationMs / MS_PER_SECOND);
      }
    }

    return {
      input_tokens: this.inputTokens,
      output_tokens: this.outputTokens,
      cache_creation_tokens: this.cacheCreationTokens,
      cache_read_tokens: this.cacheReadTokens,
      ttft_ms: this.ttftMs,
      total_duration_ms: totalDurationMs,
      tokens_per_second: tokensPerSecond,
      stop_reason: this.stopReason,
      is_complete: this.complete ? 1 : 0,
    };
  }

  static fromNonStreamResponse(
    apiType: "openai" | "anthropic",
    responseBody: string,
  ): MetricsResult | null {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(responseBody);
    } catch {
      return null;
    }

    if (apiType === "openai") {
      return extractOpenAINonStream(parsed);
    }
    return extractAnthropicNonStream(parsed);
  }

  private processAnthropicEvent(event: SSEEvent): void {
    let parsed: AnthropicMessageStart | AnthropicContentBlockDelta | AnthropicMessageDelta;
    try {
      parsed = JSON.parse(event.data!);
    } catch {
      return;
    }

    const type: string | undefined = parsed.type;

    if (type === "message_start") {
      const msg = parsed as AnthropicMessageStart;
      const usage = msg.message?.usage;
      if (usage) {
        this.inputTokens = usage.input_tokens ?? null;
        this.cacheCreationTokens = usage.cache_creation_input_tokens ?? null;
        this.cacheReadTokens = usage.cache_read_input_tokens ?? null;
      }
      this.streamStartTime = Date.now();
    } else if (type === "content_block_delta") {
      // 首次收到内容时记录 TTFT（不管是 thinking_delta 还是 text_delta）
      if (!this.firstContentReceived) {
        this.firstContentReceived = true;
        this.ttftMs = Date.now() - this.requestStartTime;
      }

      // 区分 thinking vs text 内容：gpt-tokenizer 精确统计 text tokens
      const delta = (parsed as AnthropicContentBlockDelta).delta;
      if (delta?.type === "thinking_delta") {
        this.hasThinkingContent = true;
      } else if (delta?.type === "text_delta") {
        if (this.textStreamStartTime === null) {
          this.textStreamStartTime = Date.now();
        }
        if (delta.text) {
          this.textContentBuffer += delta.text;
        }
      }
    } else if (type === "message_delta") {
      const msg = parsed as AnthropicMessageDelta;
      this.outputTokens = msg.usage?.output_tokens ?? null;
      // 第三方 Anthropic 兼容 API（如 OpenRouter、智谱）可能将 input_tokens 放在 message_delta 而非 message_start
      if (this.inputTokens === null && msg.usage?.input_tokens) {
        this.inputTokens = msg.usage.input_tokens;
      }
      this.stopReason = msg.delta?.stop_reason ?? null;
      this.streamEndTime = Date.now();
    } else if (type === "message_stop") {
      this.complete = true;
    }
  }

  private processOpenAIEvent(event: SSEEvent): void {
    // SSEParser 通常会拦截 [DONE]，但以防直接传入
    if (event.data === "[DONE]") {
      this.complete = true;
      return;
    }

    let parsed: OpenAIStreamChunk;
    try {
      parsed = JSON.parse(event.data!);
    } catch {
      return;
    }

    const choices = parsed.choices;
    if (choices && choices.length > 0) {
      const choice = choices[0];
      const delta = choice.delta;

      // 跳过只有 role 的 chunk，不视为内容
      if (
        !this.firstContentReceived &&
        delta &&
        delta.content !== undefined &&
        delta.content !== ""
      ) {
        this.firstContentReceived = true;
        this.ttftMs = Date.now() - this.requestStartTime;
      }

      if (choice.finish_reason) {
        this.stopReason = choice.finish_reason;
        this.streamEndTime = Date.now();
      }
    }

    // usage 通常在最后一个 chunk 中
    if (parsed.usage) {
      this.inputTokens = parsed.usage.prompt_tokens ?? null;
      this.outputTokens = parsed.usage.completion_tokens ?? null;
      this.cacheReadTokens =
        parsed.usage.prompt_tokens_details?.cached_tokens ?? null;

      // usage chunk 标志流结束，确保 duration 可计算
      if (this.streamStartTime === null) {
        this.streamStartTime = this.requestStartTime;
      }
      if (this.streamEndTime === null) {
        this.streamEndTime = Date.now();
      }
    }
  }
}

function extractOpenAINonStream(parsed: Record<string, unknown>): MetricsResult {
  const usage = parsed.usage as Record<string, unknown> | undefined;
  const choices = parsed.choices as Array<{ finish_reason?: string }> | undefined;
  const stopReason = choices?.[0]?.finish_reason ?? null;

  const details = usage?.prompt_tokens_details as Record<string, unknown> | undefined;

  return {
    input_tokens: (usage?.prompt_tokens as number) ?? null,
    output_tokens: (usage?.completion_tokens as number) ?? null,
    cache_creation_tokens: null,
    cache_read_tokens: (details?.cached_tokens as number) ?? null,
    ttft_ms: null,
    total_duration_ms: null,
    tokens_per_second: null,
    stop_reason: stopReason,
    is_complete: 1,
  };
}

function extractAnthropicNonStream(parsed: Record<string, unknown>): MetricsResult {
  const usage = parsed.usage as Record<string, unknown> | undefined;

  return {
    input_tokens: (usage?.input_tokens as number) ?? null,
    output_tokens: (usage?.output_tokens as number) ?? null,
    cache_creation_tokens: (usage?.cache_creation_input_tokens as number) ?? null,
    cache_read_tokens: (usage?.cache_read_input_tokens as number) ?? null,
    ttft_ms: null,
    total_duration_ms: null,
    tokens_per_second: null,
    stop_reason: (parsed.stop_reason as string) ?? null,
    is_complete: 1,
  };
}

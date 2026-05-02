// TODO: 当文件超过 400 行时拆分为 metrics-streaming.ts（流式事件处理 + TPS 计算）和 metrics-extractor.ts（非流式 + 类型）

import { MS_PER_SECOND } from "../core/constants.js";
import type { MetricsResult } from "../core/types.js";
import { encode } from "gpt-tokenizer";
import type { SSEEvent } from "./sse-parser.js";

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
  delta?: { type: string; text?: string; thinking?: string; partial_json?: string };
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

  // --- Phase content buffers + timing ---
  private thinkingContentBuffer = "";
  private thinkingStreamStartTime: number | null = null;
  private thinkingStreamEndTime: number | null = null;

  private textContentBuffer = "";
  private textStreamStartTime: number | null = null;

  private toolUseContentBuffer = "";
  private toolUseStreamStartTime: number | null = null;

  constructor(
    private apiType: "openai" | "openai-responses" | "anthropic",
    private requestStartTime: number,
  ) {}

  processEvent(event: SSEEvent): void {
    if (!event.data) return;

    if (this.apiType === "anthropic") {
      this.processAnthropicEvent(event);
    } else if (this.apiType === "openai-responses") {
      this.processResponsesEvent(event);
    } else {
      this.processOpenAIEvent(event);
    }
  }

  getMetrics(): MetricsResult {
    let totalDurationMs: number | null = null;
    let totalTps: number | null = null;
    let thinkingTps: number | null = null;
    let nonThinkingTps: number | null = null;
    let thinkingTokens: number | null = null;
    let nonThinkingDurationMs: number | null = null;
    let thinkingDurationMs: number | null = null;
    let textTokens: number | null = null;
    let toolUseTokens: number | null = null;
    const hasThinking = this.thinkingContentBuffer.length > 0;

    if (
      this.streamEndTime !== null &&
      this.outputTokens !== null
    ) {
      // total_duration: T6 - T0 (proxy end-to-end, not just stream window)
      totalDurationMs = this.streamEndTime - this.requestStartTime;
      if (totalDurationMs > 0) {
        totalTps = this.outputTokens / (totalDurationMs / MS_PER_SECOND);
      }

      if (hasThinking) {
        thinkingTokens = encode(this.thinkingContentBuffer).length;

        // thinking_duration: T3 - T0 (includes network RTT + generation)
        if (this.thinkingStreamEndTime !== null) {
          thinkingDurationMs = this.thinkingStreamEndTime - this.requestStartTime;
          if (thinkingDurationMs > 0) {
            thinkingTps = thinkingTokens / (thinkingDurationMs / MS_PER_SECOND);
          }

          // non_thinking_duration: T6 - T3
          nonThinkingDurationMs = this.streamEndTime - this.thinkingStreamEndTime;
        }
      } else {
        // non_thinking_duration: T6 - T0 (entire request duration)
        nonThinkingDurationMs = totalDurationMs;
      }

      // non_thinking_tps
      if (nonThinkingDurationMs !== null && nonThinkingDurationMs > 0) {
        const nonThinkingTokens = this.outputTokens - (thinkingTokens ?? 0);
        if (nonThinkingTokens > 0) {
          nonThinkingTps = nonThinkingTokens / (nonThinkingDurationMs / MS_PER_SECOND);
        }
      }

      // content token counts (for analysis only)
      if (this.textContentBuffer.length > 0) {
        textTokens = encode(this.textContentBuffer).length;
      }
      if (this.toolUseContentBuffer.length > 0) {
        toolUseTokens = encode(this.toolUseContentBuffer).length;
      }
    }

    return {
      input_tokens: this.inputTokens,
      output_tokens: this.outputTokens,
      cache_creation_tokens: this.cacheCreationTokens,
      cache_read_tokens: this.cacheReadTokens,
      ttft_ms: this.ttftMs,
      total_duration_ms: totalDurationMs,
      tokens_per_second: totalTps,
      stop_reason: this.stopReason,
      is_complete: this.complete ? 1 : 0,
      thinking_tokens: thinkingTokens,
      thinking_duration_ms: thinkingDurationMs,
      thinking_tps: thinkingTps,
      non_thinking_duration_ms: nonThinkingDurationMs,
      non_thinking_tps: nonThinkingTps,
      total_tps: totalTps,
      text_tokens: textTokens,
      tool_use_tokens: toolUseTokens,
    };
  }

  static fromNonStreamResponse(
    apiType: "openai" | "openai-responses" | "anthropic",
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

  private processResponsesEvent(event: SSEEvent): void {
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(event.data!) as Record<string, unknown>; } catch { return; }
    const type = obj.type as string;

    // Track first content for TTFT
    const isContentDelta = type === "response.output_text.delta"
      || type === "response.function_call_arguments.delta"
      || type === "response.reasoning_summary_text.delta";

    if (isContentDelta) {
      const delta = (obj.delta as string) ?? "";
      if (delta && !this.firstContentReceived) {
        this.firstContentReceived = true;
        this.ttftMs = Date.now() - this.requestStartTime;
      }
      this.textContentBuffer += delta;
    }

    // Track completion
    if (type === "response.completed" || type === "response.incomplete") {
      this.streamEndTime = Date.now();
      this.complete = true;
      const resp = obj.response as Record<string, unknown> | undefined;
      if (resp) {
        const usage = resp.usage as Record<string, number> | undefined;
        if (usage) {
          this.inputTokens = usage.input_tokens ?? null;
          this.outputTokens = usage.output_tokens ?? null;
        }
        const status = resp.status as string;
        if (status === "completed") this.stopReason = "end_turn";
        else if (status === "incomplete") this.stopReason = "max_tokens";
        else this.stopReason = "stop";
      }
    }
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
      if (!this.firstContentReceived) {
        this.firstContentReceived = true;
        this.ttftMs = Date.now() - this.requestStartTime;
      }

      const delta = (parsed as AnthropicContentBlockDelta).delta;
      if (delta?.type === "thinking_delta") {
        if (this.thinkingStreamStartTime === null) {
          this.thinkingStreamStartTime = Date.now();
        }
        const thinking = delta.thinking ?? "";
        if (thinking) {
          this.thinkingContentBuffer += thinking;
          this.thinkingStreamEndTime = Date.now();
        }
      } else if (delta?.type === "text_delta") {
        if (this.textStreamStartTime === null) {
          this.textStreamStartTime = Date.now();
        }
        if (delta.text) {
          this.textContentBuffer += delta.text;
        }
      } else if (delta?.type === "input_json_delta") {
        if (this.toolUseStreamStartTime === null) {
          this.toolUseStreamStartTime = Date.now();
        }
        if (delta.partial_json) {
          this.toolUseContentBuffer += delta.partial_json;
        }
      }
    } else if (type === "message_delta") {
      const msg = parsed as AnthropicMessageDelta;
      this.outputTokens = msg.usage?.output_tokens ?? null;
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

      if (
        !this.firstContentReceived &&
        delta &&
        delta.content !== undefined &&
        delta.content !== ""
      ) {
        this.firstContentReceived = true;
        this.ttftMs = Date.now() - this.requestStartTime;
        this.textStreamStartTime = Date.now();
      }

      if (delta?.content) {
        this.textContentBuffer += delta.content;
      }

      if (choice.finish_reason) {
        this.stopReason = choice.finish_reason;
        this.streamEndTime = Date.now();
      }
    }

    if (parsed.usage) {
      this.inputTokens = parsed.usage.prompt_tokens ?? null;
      this.outputTokens = parsed.usage.completion_tokens ?? null;
      this.cacheReadTokens =
        parsed.usage.prompt_tokens_details?.cached_tokens ?? null;

      if (this.streamStartTime === null) {
        this.streamStartTime = this.requestStartTime;
      }
      if (this.streamEndTime === null) {
        this.streamEndTime = Date.now();
      }
    }
  }
}

const NULL_TPS_BREAKDOWN = {
  thinking_tokens: null as number | null,
  thinking_duration_ms: null as number | null,
  thinking_tps: null as number | null,
  non_thinking_duration_ms: null as number | null,
  non_thinking_tps: null as number | null,
  total_tps: null as number | null,
  text_tokens: null as number | null,
  tool_use_tokens: null as number | null,
};

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
    ...NULL_TPS_BREAKDOWN,
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
    ...NULL_TPS_BREAKDOWN,
  };
}

import { BaseSSETransform } from "./stream-transform-base.js";
import { generateMsgId } from "./id-utils.js";
import { mapFinishReasonToStopReason } from "./usage-mapper.js";

type OA2AntState = "init" | "text" | "thinking" | "tool_use" | "closing";

export class OpenAIToAnthropicTransform extends BaseSSETransform {
  private state: OA2AntState = "init";
  private blockIndex = 0;
  private msgId = generateMsgId();
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private pendingStopReason: string | null = null;
  private hasSentMessageStop = false;
  private hasSentMessageStart = false;
  private activeToolCallIndex = -1;
  private completedToolCallIndices: Set<number> = new Set();
  private toolCallBufferedArgs: Map<number, string> = new Map();
  private finishReasonReceived = false;

  protected processEvent(event: { event?: string; data?: string }): void {
    if (event.data === "[DONE]") return;
    let chunk: Record<string, unknown>;
    try { chunk = JSON.parse(event.data!); } catch (err) { this.emit("warning", err); return; }

    // 始终提取 usage（即使 choices 同时存在）
    if (chunk.usage) {
      const u = chunk.usage as Record<string, unknown>;
      this.inputTokens = (u.prompt_tokens as number) ?? this.inputTokens;
      this.outputTokens = (u.completion_tokens as number) ?? this.outputTokens;
      const d = u.prompt_tokens_details as Record<string, unknown> | undefined;
      this.cacheReadTokens = (d?.cached_tokens as number) ?? this.cacheReadTokens;
    }

    // Usage-only chunk 触发 stop 序列
    if (chunk.usage && !(Array.isArray(chunk.choices) && chunk.choices.length > 0)) {
      if (this.pendingStopReason !== null) this.emitStopSequence();
      return;
    }

    const delta = ((chunk.choices as Array<Record<string, unknown>> | undefined)?.[0]?.delta) as Record<string, unknown> | undefined;
    if (!delta) return;
    this.ensureMessageStart();

    if (delta.reasoning_content != null && delta.reasoning_content !== "") {
      this.transitionBlock("thinking", { type: "thinking", thinking: "" });
      this.emitDelta("thinking_delta", "thinking", delta.reasoning_content as string);
    }
    if (delta.content != null && delta.content !== "") {
      this.transitionBlock("text", { type: "text", text: "" });
      this.emitDelta("text_delta", "text", delta.content as string);
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) this.handleToolCallDelta(tc as Record<string, unknown>);
    }

    const finishReason = ((chunk.choices as Array<Record<string, unknown>>)[0]?.finish_reason) as string | undefined;
    if (finishReason && !this.finishReasonReceived) {
      this.finishReasonReceived = true;
      this.closeCurrentBlock();
      this.pendingStopReason = mapFinishReasonToStopReason(finishReason);
    }
  }

  // ---------- Block 切换（统一 close→increment→start 模式） ----------

  private transitionBlock(
    target: "text" | "thinking" | "tool_use",
    blockContent: Record<string, unknown>,
  ): void {
    if (this.state === target) return;
    if (this.state !== "init") { this.emitBlockStop(); this.blockIndex++; }
    this.state = target;
    this.pushAnthropicSSE("content_block_start", {
      type: "content_block_start", index: this.blockIndex, content_block: blockContent,
    });
  }

  private closeCurrentBlock(): void {
    if (this.state !== "init" && this.state !== "closing") {
      this.emitBlockStop();
      this.state = "closing";
    }
  }

  // ---------- Tool call 处理 ----------

  private handleToolCallDelta(tc: Record<string, unknown>): void {
    const idx = (tc.index as number) ?? 0;
    const fn = tc.function as Record<string, unknown> | undefined;
    const tcId = tc.id as string | undefined;
    const tcName = fn?.name as string | undefined;
    const args = fn?.arguments as string | undefined;

    if (tcId && tcName) {
      this.openToolBlock(idx, tcId, tcName);
      if (args && args !== "") this.emitJsonDelta(args);
      return;
    }
    if (idx !== this.activeToolCallIndex && this.completedToolCallIndices.has(idx)) {
      if (args) {
        const existing = this.toolCallBufferedArgs.get(idx) ?? "";
        this.toolCallBufferedArgs.set(idx, existing + args);
      }
      return;
    }
    if (idx !== this.activeToolCallIndex && !this.completedToolCallIndices.has(idx)) {
      this.openToolBlock(idx, `tool_${idx}`, `tool_${idx}`);
    }
    if (args && args !== "") this.emitJsonDelta(args);
  }

  /** 每个 tool call 需要独立 block，即使当前已是 tool_use 状态 */
  private openToolBlock(idx: number, id: string, name: string): void {
    if (this.state !== "init") { this.emitBlockStop(); this.blockIndex++; }
    this.state = "tool_use";
    this.activeToolCallIndex = idx;
    this.pushAnthropicSSE("content_block_start", {
      type: "content_block_start", index: this.blockIndex,
      content_block: { type: "tool_use", id, name, input: {} },
    });
    this.completedToolCallIndices.add(idx);
  }

  // ---------- SSE 输出辅助 ----------

  private ensureMessageStart(): void {
    if (this.hasSentMessageStart) return;
    this.pushAnthropicSSE("message_start", {
      type: "message_start",
      message: {
        id: this.msgId, type: "message", role: "assistant", content: [],
        model: this.model, status: "in_progress",
        usage: { input_tokens: Math.max(0, this.inputTokens - this.cacheReadTokens), cache_read_input_tokens: this.cacheReadTokens },
      },
    });
    this.hasSentMessageStart = true;
  }

  private emitBlockStop(): void {
    this.pushAnthropicSSE("content_block_stop", { type: "content_block_stop", index: this.blockIndex });
  }

  private emitDelta(deltaType: string, field: string, value: string): void {
    this.pushAnthropicSSE("content_block_delta", {
      type: "content_block_delta", index: this.blockIndex,
      delta: { type: deltaType, [field]: value },
    });
  }

  private emitJsonDelta(partialJson: string): void {
    this.pushAnthropicSSE("content_block_delta", {
      type: "content_block_delta", index: this.blockIndex,
      delta: { type: "input_json_delta", partial_json: partialJson },
    });
  }

  private emitStopSequence(): void {
    if (this.hasSentMessageStop) return;
    const stopReason = this.pendingStopReason ?? "end_turn";
    this.pushAnthropicSSE("message_delta", {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { input_tokens: Math.max(0, this.inputTokens - this.cacheReadTokens) || 0, output_tokens: this.outputTokens, cache_read_input_tokens: this.cacheReadTokens },
    });
    this.pushAnthropicSSE("message_stop", { type: "message_stop" });
    this.hasSentMessageStop = true;
    this.pendingStopReason = null;
  }

  protected flushPendingData(): void {
    for (const [idx, bufferedArgs] of this.toolCallBufferedArgs) {
      if (bufferedArgs) {
        this.emit("warning", { event: "buffered_tool_call", index: idx, argsLength: bufferedArgs.length });
        this.pushAnthropicSSE("content_block_delta", {
          type: "content_block_delta", index: idx,
          delta: { type: "input_json_delta", partial_json: bufferedArgs },
        });
      }
    }
    this.toolCallBufferedArgs.clear();
  }

  protected ensureTerminated(): void {
    if (!this.hasSentMessageStop) {
      this.closeCurrentBlock();
      if (this.pendingStopReason === null) this.pendingStopReason = "end_turn";
      this.emitStopSequence();
    }
  }
}

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

  private pendingStopReason: string | null = null;
  private hasSentMessageStop = false;
  private hasSentMessageStart = false;

  private activeToolCallIndex = -1;
  private toolCallBlocks: Map<number, { id: string; name: string; args: string }> = new Map();
  private completedToolCallIndices: Set<number> = new Set();

  private finishReasonReceived = false;

  protected processEvent(event: { event?: string; data?: string }): void {
    let chunk: Record<string, unknown>;
    try { chunk = JSON.parse(event.data!); } catch (err) { this.emit("warning", err); return; }

    // P0 fix: always extract usage when present, even if choices are in the same chunk
    if (chunk.usage) {
      const usage = chunk.usage as Record<string, number>;
      this.inputTokens = usage.prompt_tokens ?? this.inputTokens;
      this.outputTokens = usage.completion_tokens ?? this.outputTokens;
    }

    // Usage-only chunk (no choices) triggers stop sequence
    if (chunk.usage && !(Array.isArray(chunk.choices) && chunk.choices.length > 0)) {
      if (this.pendingStopReason !== null) {
        this.emitStopSequence();
      }
      return;
    }

    const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
    const choice = choices?.[0];
    if (!choice) return;

    const delta = choice.delta as Record<string, unknown> | undefined;
    if (!delta) return;

    if (!this.hasSentMessageStart) {
      this.pushAnthropicSSE("message_start", {
        type: "message_start",
        message: {
          id: this.msgId, type: "message", role: "assistant", content: [],
          model: this.model, status: "in_progress",
          usage: { input_tokens: this.inputTokens },
        },
      });
      this.hasSentMessageStart = true;
    }

    if (delta.reasoning_content != null && delta.reasoning_content !== "") {
      this.ensureBlockState("thinking");
      this.pushAnthropicSSE("content_block_delta", {
        type: "content_block_delta", index: this.blockIndex,
        delta: { type: "thinking_delta", thinking: delta.reasoning_content },
      });
    }

    if (delta.content != null && delta.content !== "") {
      this.ensureBlockState("text");
      this.pushAnthropicSSE("content_block_delta", {
        type: "content_block_delta", index: this.blockIndex,
        delta: { type: "text_delta", text: delta.content },
      });
    }

    const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
    if (toolCalls) {
      for (const tc of toolCalls) {
        this.handleToolCallDelta(tc);
      }
    }

    const finishReason = choice.finish_reason as string | undefined;
    if (finishReason && !this.finishReasonReceived) {
      this.finishReasonReceived = true;
      this.closeCurrentBlock();
      this.pendingStopReason = mapFinishReasonToStopReason(finishReason);
    }
  }

  private ensureBlockState(target: "text" | "thinking"): void {
    if (this.state === target) return;
    if (this.state !== "init") {
      this.pushAnthropicSSE("content_block_stop", {
        type: "content_block_stop", index: this.blockIndex,
      });
      this.blockIndex++;
    }
    this.state = target;
    const blockContent = target === "text" ? { type: "text", text: "" } : { type: "thinking", thinking: "" };
    this.pushAnthropicSSE("content_block_start", {
      type: "content_block_start", index: this.blockIndex, content_block: blockContent,
    });
  }

  private handleToolCallDelta(tc: Record<string, unknown>): void {
    const idx = (tc.index as number) ?? 0;
    const fn = tc.function as Record<string, unknown> | undefined;
    const tcId = tc.id as string | undefined;
    const tcName = fn?.name as string | undefined;

    if (tcId && tcName) {
      if (this.state !== "init") {
        this.pushAnthropicSSE("content_block_stop", {
          type: "content_block_stop", index: this.blockIndex,
        });
        this.blockIndex++;
      }
      this.activeToolCallIndex = idx;
      this.state = "tool_use";
      this.pushAnthropicSSE("content_block_start", {
        type: "content_block_start", index: this.blockIndex,
        content_block: { type: "tool_use", id: tcId, name: tcName, input: {} },
      });
      this.completedToolCallIndices.add(idx);
      const args = fn?.arguments as string | undefined;
      if (args && args !== "") {
        this.pushAnthropicSSE("content_block_delta", {
          type: "content_block_delta", index: this.blockIndex,
          delta: { type: "input_json_delta", partial_json: args },
        });
      }
      return;
    }

    if (idx !== this.activeToolCallIndex && this.completedToolCallIndices.has(idx)) {
      const args = fn?.arguments as string | undefined;
      if (args) {
        const existing = this.toolCallBlocks.get(idx);
        if (existing) { existing.args += args; }
        else { this.toolCallBlocks.set(idx, { id: "", name: "", args }); }
      }
      return;
    }

    if (idx !== this.activeToolCallIndex && !this.completedToolCallIndices.has(idx)) {
      if (this.state !== "init") {
        this.pushAnthropicSSE("content_block_stop", {
          type: "content_block_stop", index: this.blockIndex,
        });
        this.blockIndex++;
      }
      this.activeToolCallIndex = idx;
      this.state = "tool_use";
      // P1 fix: emit content_block_start for previously unseen tool call index
      this.pushAnthropicSSE("content_block_start", {
        type: "content_block_start", index: this.blockIndex,
        content_block: { type: "tool_use", id: `tool_${idx}`, name: `tool_${idx}`, input: {} },
      });
      this.completedToolCallIndices.add(idx);
    }

    const args = fn?.arguments as string | undefined;
    if (args && args !== "") {
      this.pushAnthropicSSE("content_block_delta", {
        type: "content_block_delta", index: this.blockIndex,
        delta: { type: "input_json_delta", partial_json: args },
      });
    }
  }

  private closeCurrentBlock(): void {
    if (this.state !== "init" && this.state !== "closing") {
      this.pushAnthropicSSE("content_block_stop", {
        type: "content_block_stop", index: this.blockIndex,
      });
      this.state = "closing";
    }
  }

  private emitStopSequence(): void {
    if (this.hasSentMessageStop) return;
    const stopReason = this.pendingStopReason ?? "end_turn";
    this.pushAnthropicSSE("message_delta", {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: this.outputTokens },
    });
    this.pushAnthropicSSE("message_stop", { type: "message_stop" });
    this.hasSentMessageStop = true;
    this.pendingStopReason = null;
  }

  protected flushPendingData(): void {
    for (const [idx, data] of this.toolCallBlocks) {
      if (data.args) {
        this.emit("warning", { event: "buffered_tool_call", index: idx, argsLength: data.args.length });
      }
    }
    this.toolCallBlocks.clear();
  }

  protected ensureTerminated(): void {
    if (!this.hasSentMessageStop) {
      this.closeCurrentBlock();
      if (this.pendingStopReason === null) this.pendingStopReason = "end_turn";
      this.emitStopSequence();
    }
  }
}

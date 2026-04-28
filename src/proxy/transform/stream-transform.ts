import { Transform, TransformCallback } from "stream";
import { randomUUID } from "crypto";
import { SafeSSEParser } from "../patch/safe-sse-parser.js";
import { mapFinishReasonToStopReason } from "./usage-mapper.js";

// ---------- FormatStreamTransform 基类 ----------

abstract class FormatStreamTransform extends Transform {
  protected parser = new SafeSSEParser();
  protected done = false;
  protected model: string;

  constructor(model: string) {
    super();
    this.model = model;
  }

  _transform(chunk: Buffer, _: BufferEncoding, callback: TransformCallback): void {
    if (this.done) { callback(); return; }
    try {
      const text = chunk.toString("utf-8");
      const events = this.parser.feed(text);
      for (const event of events) {
        if (event.data == null) continue;
        try {
          this.processEvent(event);
        } catch (err) {
          this.emit("warning", { event: "process_error", error: String(err) });
        }
      }
    } catch (err) {
      this.emit("warning", { event: "buffer_overflow", error: String(err) });
      this.pushDone();
    }
    callback();
  }

  _flush(callback: TransformCallback): void {
    const events = this.parser.flush();
    for (const event of events) {
      try { this.processEvent(event); } catch { /* ignore residual parse errors */ }
    }
    this.flushPendingData();
    this.ensureTerminated();
    callback();
  }

  protected abstract processEvent(event: { event?: string; data?: string }): void;
  protected abstract flushPendingData(): void;
  protected abstract ensureTerminated(): void;

  protected pushAnthropicSSE(eventType: string, data: unknown): void {
    this.push(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  protected pushOpenAISSE(data: unknown): void {
    this.push(`data: ${JSON.stringify(data)}\n\n`);
  }

  protected pushDone(): void {
    this.push("data: [DONE]\n\n");
    this.done = true;
  }
}

// ---------- OpenAIToAnthropicTransform ----------

type OA2AntState = "init" | "text" | "thinking" | "tool_use" | "closing";

class OpenAIToAnthropicTransform extends FormatStreamTransform {
  private state: OA2AntState = "init";
  private blockIndex = 0;
  private msgId = `msg_${randomUUID().slice(0, 24)}`;
  private inputTokens = 0;
  private outputTokens = 0;

  // P0-1: 延迟发送 stop 事件
  private pendingStopReason: string | null = null;
  private hasSentMessageStop = false;
  private hasSentMessageStart = false;

  // P1-8: 交错 tool call 缓冲
  private activeToolCallIndex = -1;
  private toolCallBlocks: Map<number, { id: string; name: string; args: string }> = new Map();
  private completedToolCallIndices: Set<number> = new Set();

  // P2-16: 重复 finish_reason 幂等
  private finishReasonReceived = false;

  protected processEvent(event: { event?: string; data?: string }): void {
    if (event.data === "[DONE]") {
      this.handleDone();
      return;
    }

    let chunk: Record<string, unknown>;
    try { chunk = JSON.parse(event.data!); } catch { return; }

    // Usage chunk（可能在 finish_reason 之后单独到达）
    if (chunk.usage && !(Array.isArray(chunk.choices) && chunk.choices.length > 0)) {
      const usage = chunk.usage as Record<string, number>;
      this.inputTokens = usage.prompt_tokens ?? this.inputTokens;
      this.outputTokens = usage.completion_tokens ?? this.outputTokens;
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

    // 首 chunk 只发 message_start
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

    // thinking 优先
    if (delta.reasoning_content != null && delta.reasoning_content !== "") {
      this.ensureBlockState("thinking");
      this.pushAnthropicSSE("content_block_delta", {
        type: "content_block_delta", index: this.blockIndex,
        delta: { type: "thinking_delta", thinking: delta.reasoning_content },
      });
    }

    // text
    if (delta.content != null && delta.content !== "") {
      this.ensureBlockState("text");
      this.pushAnthropicSSE("content_block_delta", {
        type: "content_block_delta", index: this.blockIndex,
        delta: { type: "text_delta", text: delta.content },
      });
    }

    // tool_calls
    const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
    if (toolCalls) {
      for (const tc of toolCalls) {
        this.handleToolCallDelta(tc);
      }
    }

    // finish_reason
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

    // 首次出现：带 id 和 name → 开新 block
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
      // 首次 arguments
      const args = fn?.arguments as string | undefined;
      if (args && args !== "") {
        this.pushAnthropicSSE("content_block_delta", {
          type: "content_block_delta", index: this.blockIndex,
          delta: { type: "input_json_delta", partial_json: args },
        });
      }
      return;
    }

    // 交错检测：index 回退到已关闭的 block
    if (idx !== this.activeToolCallIndex && this.completedToolCallIndices.has(idx)) {
      const args = fn?.arguments as string | undefined;
      if (args) {
        const existing = this.toolCallBlocks.get(idx);
        if (existing) { existing.args += args; }
        else { this.toolCallBlocks.set(idx, { id: "", name: "", args }); }
      }
      return;
    }

    // index 不匹配且不是回退 → 关闭前一个开新 block
    if (idx !== this.activeToolCallIndex && !this.completedToolCallIndices.has(idx)) {
      if (this.state !== "init") {
        this.pushAnthropicSSE("content_block_stop", {
          type: "content_block_stop", index: this.blockIndex,
        });
        this.blockIndex++;
      }
      this.activeToolCallIndex = idx;
      this.state = "tool_use";
    }

    // arguments delta
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

  private handleDone(): void {
    this.closeCurrentBlock();
    if (this.pendingStopReason !== null || !this.hasSentMessageStop) {
      if (this.pendingStopReason === null) this.pendingStopReason = "end_turn";
      this.emitStopSequence();
    }
    this.done = true;
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

// ---------- AnthropicToOpenAITransform ----------

class AnthropicToOpenAITransform extends FormatStreamTransform {
  private chatcmplId = `chatcmpl-${randomUUID().slice(0, 24)}`;
  private firstContentBlock = true;
  private inputTokens = 0;
  private outputTokens = 0;
  private finishReasonEmitted = false;
  private currentToolCallIndex = 0;
  private blockToToolCallIndex: Map<number, number> = new Map();

  protected processEvent(event: { event?: string; data?: string }): void {
    let data: Record<string, unknown>;
    try { data = JSON.parse(event.data!); } catch { return; }

    switch (data.type) {
      case "message_start": {
        const msg = data.message as Record<string, unknown> | undefined;
        const usage = msg?.usage as Record<string, unknown> | undefined;
        this.inputTokens = (usage?.input_tokens as number) ?? 0;
        break;
      }

      case "content_block_start": {
        const block = data.content_block as Record<string, unknown>;
        const blockType = block?.type as string;
        const blockIdx = (data.index as number) ?? 0;

        // 首个 content block 时发送 role chunk
        if (this.firstContentBlock) {
          this.pushOpenAISSE({
            id: this.chatcmplId, object: "chat.completion.chunk",
            choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
          });
          this.firstContentBlock = false;
        }

        if (blockType === "tool_use") {
          const tcIndex = this.currentToolCallIndex++;
          this.blockToToolCallIndex.set(blockIdx, tcIndex);
          this.pushOpenAISSE({
            id: this.chatcmplId, object: "chat.completion.chunk",
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: tcIndex, id: block.id, type: "function",
                  function: { name: block.name, arguments: "" },
                }],
              },
              finish_reason: null,
            }],
          });
        }
        // text 和 thinking blocks 不在 start 时输出，等 delta 时输出
        break;
      }

      case "content_block_delta": {
        const delta = data.delta as Record<string, unknown>;
        const blockIdx = (data.index as number) ?? 0;
        const deltaType = delta?.type as string;

        if (deltaType === "text_delta") {
          const text = delta.text as string;
          if (!text) break;
          this.pushOpenAISSE({
            id: this.chatcmplId, object: "chat.completion.chunk",
            choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
          });
        } else if (deltaType === "thinking_delta") {
          const thinking = delta.thinking as string;
          if (!thinking) break;
          this.pushOpenAISSE({
            id: this.chatcmplId, object: "chat.completion.chunk",
            choices: [{ index: 0, delta: { reasoning_content: thinking }, finish_reason: null }],
          });
        } else if (deltaType === "input_json_delta") {
          const partialJson = delta.partial_json as string;
          if (!partialJson) break;
          const tcIndex = this.blockToToolCallIndex.get(blockIdx) ?? 0;
          this.pushOpenAISSE({
            id: this.chatcmplId, object: "chat.completion.chunk",
            choices: [{
              index: 0,
              delta: { tool_calls: [{ index: tcIndex, function: { arguments: partialJson } }] },
              finish_reason: null,
            }],
          });
        }
        break;
      }

      case "content_block_stop": {
        // OpenAI 无对应事件
        break;
      }

      case "message_delta": {
        const msgDelta = data.delta as Record<string, unknown>;
        const usage = data.usage as Record<string, unknown> | undefined;
        this.outputTokens = (usage?.output_tokens as number) ?? this.outputTokens;

        const stopReason = msgDelta?.stop_reason as string | undefined;
        if (stopReason && !this.finishReasonEmitted) {
          this.finishReasonEmitted = true;
          const fr = stopReason === "end_turn" ? "stop"
            : stopReason === "max_tokens" ? "length"
            : stopReason === "stop_sequence" ? "stop"
            : stopReason === "tool_use" ? "tool_calls"
            : "stop";
          this.pushOpenAISSE({
            id: this.chatcmplId, object: "chat.completion.chunk",
            choices: [{ index: 0, delta: {}, finish_reason: fr }],
          });
        }
        break;
      }

      case "message_stop": {
        this.pushOpenAISSE({
          id: this.chatcmplId, object: "chat.completion.chunk",
          choices: [],
          usage: {
            prompt_tokens: this.inputTokens,
            completion_tokens: this.outputTokens,
            total_tokens: this.inputTokens + this.outputTokens,
          },
        });
        this.pushDone();
        break;
      }

      case "error": {
        const error = data.error as Record<string, unknown>;
        this.pushOpenAISSE({
          error: {
            message: (error?.message as string) ?? "Stream error",
            type: (error?.type as string) ?? "api_error",
            code: "upstream_error",
          },
        });
        this.pushDone();
        break;
      }

      case "ping": {
        // 静默丢弃
        break;
      }

      default: {
        this.emit("warning", { event: "unknown_event", type: data.type });
        break;
      }
    }
  }

  protected flushPendingData(): void {
    // Anthropic 流不产生交错数据
  }

  protected ensureTerminated(): void {
    if (!this.done) {
      if (!this.finishReasonEmitted) {
        this.pushOpenAISSE({
          id: this.chatcmplId, object: "chat.completion.chunk",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        });
      }
      this.pushDone();
    }
  }
}

export { FormatStreamTransform, OpenAIToAnthropicTransform, AnthropicToOpenAITransform };

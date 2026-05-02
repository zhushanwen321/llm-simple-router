import { BaseSSETransform } from "./stream-transform-base.js";
import { generateMsgId } from "./id-utils.js";

interface TrackedItem {
  type: string;
  id: string;
  name?: string;
  callId?: string;
  outputIndex: number;
}

export class ResponsesToAnthropicTransform extends BaseSSETransform {
  private hasSentMessageStart = false;
  private blockIndex = 0;
  private msgId = generateMsgId();
  private inputTokens = 0;
  private outputTokens = 0;
  private currentOutputIndex = -1;
  private hasSentMessageStop = false;
  private hasFunctionCall = false;
  // Track current items by output_index
  private activeItems: Map<number, TrackedItem> = new Map();

  private ensureMessageStart(): void {
    if (this.hasSentMessageStart) return;
    this.hasSentMessageStart = true;
    this.pushAnthropicSSE("message_start", {
      type: "message_start",
      message: {
        id: this.msgId,
        type: "message",
        role: "assistant",
        content: [],
        model: this.model,
        status: "in_progress",
        usage: { input_tokens: this.inputTokens },
      },
    });
  }

  protected processEvent(event: { event?: string; data?: string }): void {
    const eventType = event.event;
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(event.data!); } catch (err) { this.emit("warning", err); return; }

    switch (eventType) {
      case "response.created":
      case "response.in_progress":
      case "response.queued": {
        // Extract usage from response object if present
        const resp = payload.response as Record<string, unknown> | undefined;
        if (resp?.usage) {
          const usage = resp.usage as Record<string, unknown>;
          this.inputTokens = (usage.input_tokens as number) ?? this.inputTokens;
        }
        break;
      }

      case "response.output_item.added": {
        this.ensureMessageStart();
        const item = payload.item as Record<string, unknown>;
        const outputIdx = (payload.output_index as number) ?? this.blockIndex;
        this.currentOutputIndex = outputIdx;
        const itemType = item?.type as string;

        const tracked: TrackedItem = {
          type: itemType,
          id: (item?.id as string) ?? "",
          name: item?.name as string | undefined,
          callId: (item?.call_id as string) ?? undefined,
          outputIndex: outputIdx,
        };
        this.activeItems.set(outputIdx, tracked);

        if (itemType === "message") {
          // Don't start content block yet — wait for content_part.added
        } else if (itemType === "function_call") {
          this.hasFunctionCall = true;
          const rawCallId = tracked.callId ?? tracked.id;
          // Anthropic requires "toolu_" prefix on tool_use IDs
          const toolId = rawCallId.startsWith("toolu_") ? rawCallId : `toolu_${rawCallId}`;
          const toolName = tracked.name ?? "";
          this.pushAnthropicSSE("content_block_start", {
            type: "content_block_start",
            index: this.blockIndex,
            content_block: { type: "tool_use", id: toolId, name: toolName, input: {} },
          });
        } else if (itemType === "reasoning") {
          this.pushAnthropicSSE("content_block_start", {
            type: "content_block_start",
            index: this.blockIndex,
            content_block: { type: "thinking", thinking: "" },
          });
        }
        break;
      }

      case "response.content_part.added": {
        this.ensureMessageStart();
        const part = payload.part as Record<string, unknown>;
        const partType = part?.type as string;
        if (partType === "output_text") {
          this.pushAnthropicSSE("content_block_start", {
            type: "content_block_start",
            index: this.blockIndex,
            content_block: { type: "text", text: "" },
          });
        }
        break;
      }

      case "response.output_text.delta": {
        const delta = payload.delta as string;
        if (delta) {
          this.pushAnthropicSSE("content_block_delta", {
            type: "content_block_delta",
            index: this.blockIndex,
            delta: { type: "text_delta", text: delta },
          });
        }
        break;
      }

      case "response.output_text.done":
      case "response.content_part.done": {
        // Nothing to emit — wait for output_item.done to send content_block_stop
        break;
      }

      case "response.reasoning_summary_text.delta": {
        const delta = payload.delta as string;
        if (delta) {
          this.pushAnthropicSSE("content_block_delta", {
            type: "content_block_delta",
            index: this.blockIndex,
            delta: { type: "thinking_delta", thinking: delta },
          });
        }
        break;
      }

      case "response.reasoning_summary_part.added":
      case "response.reasoning_summary_text.done":
      case "response.reasoning_summary_part.done": {
        // Sub-events of reasoning — no Anthropic equivalent, handled at output_item.done
        break;
      }

      case "response.function_call_arguments.delta": {
        const delta = payload.delta as string;
        if (delta) {
          this.pushAnthropicSSE("content_block_delta", {
            type: "content_block_delta",
            index: this.blockIndex,
            delta: { type: "input_json_delta", partial_json: delta },
          });
        }
        break;
      }

      case "response.function_call_arguments.done": {
        // Nothing — wait for output_item.done
        break;
      }

      case "response.output_item.done": {
        const outputIdx = (payload.output_index as number) ?? this.currentOutputIndex;

        // content_block_stop — same for all item types (index-only)
        this.pushAnthropicSSE("content_block_stop", {
          type: "content_block_stop",
          index: this.blockIndex,
        });

        this.activeItems.delete(outputIdx);
        this.blockIndex++;
        break;
      }

      case "response.completed": {
        const resp = payload.response as Record<string, unknown>;
        if (resp?.usage) {
          const usage = resp.usage as Record<string, unknown>;
          this.inputTokens = (usage.input_tokens as number) ?? this.inputTokens;
          this.outputTokens = (usage.output_tokens as number) ?? this.outputTokens;
        }
        this.emitStopSequence(resp?.status as string);
        break;
      }

      case "response.incomplete": {
        const resp = payload.response as Record<string, unknown>;
        if (resp?.usage) {
          const usage = resp.usage as Record<string, unknown>;
          this.outputTokens = (usage.output_tokens as number) ?? this.outputTokens;
        }
        this.emitStopSequence("incomplete");
        break;
      }

      case "response.failed": {
        const resp = payload.response as Record<string, unknown>;
        const err = resp?.error as Record<string, unknown> | undefined;
        this.pushAnthropicSSE("error", {
          type: "error",
          error: {
            type: "api_error",
            message: (err?.message as string) ?? "Upstream error",
          },
        });
        break;
      }

      case "error": {
        this.pushAnthropicSSE("error", {
          type: "error",
          error: {
            type: "api_error",
            message: (payload.message as string) ?? "Stream error",
          },
        });
        break;
      }

      default: {
        this.emit("warning", { event: "unknown_sse_event", eventType });
        break;
      }
    }
  }

  private emitStopSequence(status?: string): void {
    if (this.hasSentMessageStop) return;
    const stopReason = this.resolveStopReason(status);
    this.pushAnthropicSSE("message_delta", {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: this.outputTokens },
    });
    this.pushAnthropicSSE("message_stop", { type: "message_stop" });
    this.hasSentMessageStop = true;
  }

  private resolveStopReason(status?: string): string {
    if (status === "incomplete") return "max_tokens";
    if (this.hasFunctionCall) return "tool_use";
    return "end_turn";
  }

  protected flushPendingData(): void {
    // No buffered data
  }

  protected ensureTerminated(): void {
    if (!this.hasSentMessageStop) {
      this.ensureMessageStart();
      this.emitStopSequence("completed");
    }
  }
}

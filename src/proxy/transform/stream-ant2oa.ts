import { BaseSSETransform } from "./stream-transform-base.js";
import { generateChatcmplId } from "./id-utils.js";

export class AnthropicToOpenAITransform extends BaseSSETransform {
  private chatcmplId = generateChatcmplId();
  private firstContentBlock = true;
  private inputTokens = 0;
  private outputTokens = 0;
  private finishReasonEmitted = false;
  private currentToolCallIndex = 0;
  private blockToToolCallIndex: Map<number, number> = new Map();

  protected processEvent(event: { event?: string; data?: string }): void {
    let data: Record<string, unknown>;
    try { data = JSON.parse(event.data!); } catch (err) { this.emit("warning", err); return; }

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

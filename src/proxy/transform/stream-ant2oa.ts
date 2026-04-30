import { BaseSSETransform } from "./stream-transform-base.js";
import { generateChatcmplId } from "./id-utils.js";
import { mapStopReasonToFinishReason } from "./usage-mapper.js";
import type { AnthropicProviderMeta } from "./provider-meta.js";

export class AnthropicToOpenAITransform extends BaseSSETransform {
  private chatcmplId = generateChatcmplId();
  private firstContentBlock = true;
  private inputTokens = 0;
  private outputTokens = 0;
  private finishReasonEmitted = false;
  private currentToolCallIndex = 0;
  private blockToToolCallIndex: Map<number, number> = new Map();
  // track content block types for PSF capture
  private contentBlockTypes: Map<number, string> = new Map();
  private contentBlockSignatures: Map<number, string> = new Map();
  // PSF accumulation for streaming
  private thinkingSignatures: Array<{ index: number; signature: string }> = [];
  private cacheUsage: AnthropicProviderMeta["cache_usage"];

  protected processEvent(event: { event?: string; data?: string }): void {
    let data: Record<string, unknown>;
    try { data = JSON.parse(event.data!); } catch (err) { this.emit("warning", err); return; }

    switch (data.type) {
      case "message_start": {
        const msg = data.message as Record<string, unknown> | undefined;
        const usage = msg?.usage as Record<string, unknown> | undefined;
        this.inputTokens = (usage?.input_tokens as number) ?? 0;
        // capture cache usage from initial usage
        if (usage?.cache_read_input_tokens != null || usage?.cache_creation_input_tokens != null) {
          this.cacheUsage = {
            cache_read_input_tokens: usage.cache_read_input_tokens as number | undefined,
            cache_creation_input_tokens: usage.cache_creation_input_tokens as number | undefined,
          };
        }
        break;
      }

      case "content_block_start": {
        const block = data.content_block as Record<string, unknown>;
        const blockType = block?.type as string;
        const blockIdx = (data.index as number) ?? 0;

        // track block type for PSF capture at content_block_stop
        this.contentBlockTypes.set(blockIdx, blockType);
        if (blockType === "thinking" && block.signature) {
          this.contentBlockSignatures.set(blockIdx, block.signature as string);
        }

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
        const blockIdx = (data.index as number) ?? 0;
        // capture thinking signature from completed block
        const sig = this.contentBlockSignatures.get(blockIdx);
        if (sig && this.contentBlockTypes.get(blockIdx) === "thinking") {
          this.thinkingSignatures.push({ index: blockIdx, signature: sig });
        }
        // Anthropic may also send signature in content_block_stop's content_block field
        const stopBlock = data.content_block as Record<string, unknown> | undefined;
        if (stopBlock?.type === "thinking" && stopBlock.signature && !sig) {
          this.thinkingSignatures.push({ index: blockIdx, signature: stopBlock.signature as string });
        }
        break;
      }

      case "message_delta": {
        const msgDelta = data.delta as Record<string, unknown>;
        const usage = data.usage as Record<string, unknown> | undefined;
        this.outputTokens = (usage?.output_tokens as number) ?? this.outputTokens;

        const stopReason = msgDelta?.stop_reason as string | undefined;
        if (stopReason && !this.finishReasonEmitted) {
          this.finishReasonEmitted = true;
          const fr = mapStopReasonToFinishReason(stopReason);
          this.pushOpenAISSE({
            id: this.chatcmplId, object: "chat.completion.chunk",
            choices: [{ index: 0, delta: {}, finish_reason: fr }],
          });
        }
        break;
      }

      case "message_stop": {
        // emit PSF as custom message_meta event before final usage
        if (this.thinkingSignatures.length > 0 || this.cacheUsage) {
          const meta: AnthropicProviderMeta = {};
          if (this.thinkingSignatures.length > 0) meta.thinking_signatures = this.thinkingSignatures;
          if (this.cacheUsage) meta.cache_usage = this.cacheUsage;
          this.push(`event: message_meta\ndata: ${JSON.stringify({ provider_meta: { anthropic: meta } })}\n\n`);
        }

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

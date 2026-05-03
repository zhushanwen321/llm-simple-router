import { BaseSSETransform } from "./stream-transform-base.js";
import { generateChatcmplId } from "./id-utils.js";

/**
 * Bridge transform: Responses API SSE → Chat Completions SSE.
 *
 * Used when the client sends a Chat Completions request but the upstream
 * provider speaks Responses API. This is a lossy conversion —
 * Chat Completions has fewer event types than Responses API.
 */
export class ResponsesToChatBridgeTransform extends BaseSSETransform {
  private chatcmplId = generateChatcmplId();
  private hasSentRole = false;
  private currentToolCallIndex = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private finishReasonEmitted = false;
  private hasFunctionCall = false;

  private ensureRoleSent(): void {
    if (this.hasSentRole) return;
    this.hasSentRole = true;
    this.pushOpenAISSE({
      id: this.chatcmplId,
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
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
          this.outputTokens = (usage.output_tokens as number) ?? this.outputTokens;
        }
        break;
      }

      case "response.output_text.delta": {
        this.ensureRoleSent();
        const delta = payload.delta as string;
        if (delta) {
          this.pushOpenAISSE({
            id: this.chatcmplId,
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
          });
        }
        break;
      }

      case "response.output_item.added": {
        const item = payload.item as Record<string, unknown>;
        const itemType = item?.type as string;

        if (itemType === "function_call") {
          this.ensureRoleSent();
          this.hasFunctionCall = true;
          const tcIndex = this.currentToolCallIndex++;
          const callId = (item.call_id as string) ?? (item.id as string);
          const name = (item.name as string) ?? "";
          this.pushOpenAISSE({
            id: this.chatcmplId,
            object: "chat.completion.chunk",
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: tcIndex,
                  id: callId,
                  type: "function",
                  function: { name, arguments: "" },
                }],
              },
              finish_reason: null,
            }],
          });
        }
        // Other item types (message, reasoning) — skip, content comes via delta events
        break;
      }

      case "response.function_call_arguments.delta": {
        const delta = payload.delta as string;
        if (delta) {
          // Use currentToolCallIndex - 1 because the tool call was already registered
          const tcIndex = this.currentToolCallIndex - 1;
          this.pushOpenAISSE({
            id: this.chatcmplId,
            object: "chat.completion.chunk",
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{ index: tcIndex, function: { arguments: delta } }],
              },
              finish_reason: null,
            }],
          });
        }
        break;
      }

      case "response.reasoning_summary_text.delta": {
        this.ensureRoleSent();
        const delta = payload.delta as string;
        if (delta) {
          this.pushOpenAISSE({
            id: this.chatcmplId,
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: { reasoning_content: delta }, finish_reason: null }],
          });
        }
        break;
      }

      case "response.completed": {
        const resp = payload.response as Record<string, unknown>;
        if (resp?.usage) {
          const usage = resp.usage as Record<string, unknown>;
          this.inputTokens = (usage.input_tokens as number) ?? this.inputTokens;
          this.outputTokens = (usage.output_tokens as number) ?? this.outputTokens;
        }

        if (!this.finishReasonEmitted) {
          this.finishReasonEmitted = true;
          const finishReason = this.hasFunctionCall ? "tool_calls" : "stop";
          this.pushOpenAISSE({
            id: this.chatcmplId,
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
          });
        }

        // Emit usage chunk
        this.pushOpenAISSE({
          id: this.chatcmplId,
          object: "chat.completion.chunk",
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

      case "response.incomplete": {
        if (!this.finishReasonEmitted) {
          this.finishReasonEmitted = true;
          this.pushOpenAISSE({
            id: this.chatcmplId,
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: {}, finish_reason: "length" }],
          });
        }
        this.pushOpenAISSE({
          id: this.chatcmplId,
          object: "chat.completion.chunk",
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

      case "response.failed": {
        const resp = payload.response as Record<string, unknown>;
        const err = resp?.error as Record<string, unknown> | undefined;
        this.pushOpenAISSE({
          error: {
            message: (err?.message as string) ?? "Upstream error",
            type: (err?.type as string) ?? "api_error",
            code: (err?.code as string) ?? "upstream_error",
          },
        });
        this.pushDone();
        break;
      }

      case "response.output_text.done":
      case "response.content_part.added":
      case "response.content_part.done":
      case "response.output_item.done":
      case "response.function_call_arguments.done":
      case "response.reasoning_summary_part.added":
      case "response.reasoning_summary_text.done":
      case "response.reasoning_summary_part.done":
      case "response.reasoning_text.delta":
      case "response.reasoning_text.done":
      case "response.refusal.delta":
      case "response.refusal.done": {
        // These events don't map to Chat SSE — skip
        break;
      }

      case "error": {
        this.pushOpenAISSE({
          error: {
            message: (payload.message as string) ?? "Stream error",
            type: (payload.type as string) ?? "api_error",
            code: "upstream_error",
          },
        });
        this.pushDone();
        break;
      }

      default: {
        this.emit("warning", { event: "unknown_sse_event", eventType });
        break;
      }
    }
  }

  protected flushPendingData(): void {
    // No buffered data
  }

  protected ensureTerminated(): void {
    if (!this.done) {
      this.ensureRoleSent();
      if (!this.finishReasonEmitted) {
        this.finishReasonEmitted = true;
        this.pushOpenAISSE({
          id: this.chatcmplId,
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        });
      }
      this.pushDone();
    }
  }
}

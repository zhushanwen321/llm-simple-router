import { randomBytes } from "crypto";
import { BaseSSETransform } from "./stream-transform-base.js";
import { generateRespId, MS_PER_SECOND } from "./id-utils.js";
import { RESPONSES_SSE_EVENTS } from "./types-responses.js";
import type { ResponsesApiResponse, ResponseOutputItem } from "./types-responses.js";

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

const ID_HEX_LENGTH = 12;

/**
 * Bridge transform: Chat Completions SSE → Responses API SSE.
 *
 * Used when the client sends a Responses API request but the upstream
 * provider speaks Chat Completions. This is a lossy conversion —
 * Responses API has richer event types than Chat delta chunks.
 */
export class ChatToResponsesBridgeTransform extends BaseSSETransform {
  private responseId = generateRespId();
  private hasResponseCreated = false;
  private outputIndex = 0;
  private contentIndex = 0;
  private sequenceNumber = 0;
  private hasMessageItemStarted = false;
  private hasContentPartStarted = false;
  private hasReasoningItemStarted = false;
  private inputTokens = 0;
  private outputTokens = 0;
  private pendingCompletion = false;
  private collectedOutput: ResponseOutputItem[] = [];
  private currentMessageItemId = "";
  private currentFunctionCallId = "";
  private currentFunctionCallName = "";
  private currentReasoningItemId = "";
  private createdAt = Math.floor(Date.now() / MS_PER_SECOND);

  private nextSeq(): number {
    return this.sequenceNumber++;
  }

  private ensureResponseCreated(): void {
    if (this.hasResponseCreated) return;
    this.hasResponseCreated = true;
    const base = {
      id: this.responseId,
      object: "response" as const,
      model: this.model,
      status: "in_progress",
      output: [],
      created_at: this.createdAt,
    };
    this.pushResponsesSSE(RESPONSES_SSE_EVENTS.CREATED, {
      type: RESPONSES_SSE_EVENTS.CREATED,
      response: { ...base, status: "queued" },
      sequence_number: this.nextSeq(),
    });
    this.pushResponsesSSE(RESPONSES_SSE_EVENTS.IN_PROGRESS, {
      type: RESPONSES_SSE_EVENTS.IN_PROGRESS,
      response: base,
      sequence_number: this.nextSeq(),
    });
  }

  private closeCurrentMessageItem(): void {
    if (this.hasContentPartStarted) {
      this.pushResponsesSSE(RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DONE, {
        type: RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DONE,
        output_index: this.outputIndex,
        content_index: this.contentIndex,
        text: "",
        sequence_number: this.nextSeq(),
      });
      this.pushResponsesSSE(RESPONSES_SSE_EVENTS.CONTENT_PART_DONE, {
        type: RESPONSES_SSE_EVENTS.CONTENT_PART_DONE,
        output_index: this.outputIndex,
        content_index: this.contentIndex,
        part: { type: "output_text", text: "", annotations: [] },
        sequence_number: this.nextSeq(),
      });
      this.hasContentPartStarted = false;
    }
    if (this.hasMessageItemStarted) {
      this.pushResponsesSSE(RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE, {
        type: RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE,
        output_index: this.outputIndex,
        item: {
          type: "message",
          id: this.currentMessageItemId,
          role: "assistant",
          content: [{ type: "output_text", text: "", annotations: [] }],
          status: "completed",
        },
        sequence_number: this.nextSeq(),
      });
      this.collectedOutput.push({
        type: "message",
        id: this.currentMessageItemId,
        role: "assistant",
        content: [{ type: "output_text", text: "", annotations: [] }],
      });
      this.hasMessageItemStarted = false;
      this.outputIndex++;
    }
  }

  private closeCurrentReasoningItem(): void {
    if (!this.hasReasoningItemStarted) return;
    this.pushResponsesSSE(RESPONSES_SSE_EVENTS.REASONING_SUMMARY_TEXT_DONE, {
      type: RESPONSES_SSE_EVENTS.REASONING_SUMMARY_TEXT_DONE,
      output_index: this.outputIndex,
      summary_index: 0,
      text: "",
      sequence_number: this.nextSeq(),
    });
    this.pushResponsesSSE(RESPONSES_SSE_EVENTS.REASONING_SUMMARY_PART_DONE, {
      type: RESPONSES_SSE_EVENTS.REASONING_SUMMARY_PART_DONE,
      output_index: this.outputIndex,
      summary_index: 0,
      part: { type: "summary_text", text: "" },
      sequence_number: this.nextSeq(),
    });
    this.pushResponsesSSE(RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE, {
      type: RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE,
      output_index: this.outputIndex,
      item: {
        type: "reasoning",
        id: this.currentReasoningItemId,
        summary: [{ type: "summary_text", text: "" }],
      },
      sequence_number: this.nextSeq(),
    });
    this.collectedOutput.push({
      type: "reasoning",
      id: this.currentReasoningItemId,
      summary: [{ type: "summary_text", text: "" }],
    });
    this.hasReasoningItemStarted = false;
    this.outputIndex++;
  }

  private closeCurrentFunctionCall(): void {
    this.pushResponsesSSE(RESPONSES_SSE_EVENTS.FUNCTION_CALL_ARGUMENTS_DONE, {
      type: RESPONSES_SSE_EVENTS.FUNCTION_CALL_ARGUMENTS_DONE,
      output_index: this.outputIndex,
      item_id: this.currentFunctionCallId,
      call_id: this.currentFunctionCallId,
      arguments: "",
      sequence_number: this.nextSeq(),
    });
    this.pushResponsesSSE(RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE, {
      type: RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE,
      output_index: this.outputIndex,
      item: {
        type: "function_call",
        id: this.currentFunctionCallId,
        call_id: this.currentFunctionCallId,
        name: this.currentFunctionCallName,
        arguments: "",
        status: "completed",
      },
      sequence_number: this.nextSeq(),
    });
    this.collectedOutput.push({
      type: "function_call",
      id: this.currentFunctionCallId,
      call_id: this.currentFunctionCallId,
      name: this.currentFunctionCallName,
      arguments: "",
    });
    this.outputIndex++;
    this.currentFunctionCallId = "";
    this.currentFunctionCallName = "";
  }

  private closeAllOpenItems(): void {
    this.closeCurrentReasoningItem();
    this.closeCurrentMessageItem();
    if (this.currentFunctionCallId) {
      this.closeCurrentFunctionCall();
    }
  }

  private emitCompleted(): void {
    const completedAt = Math.floor(Date.now() / MS_PER_SECOND);
    const response: ResponsesApiResponse = {
      id: this.responseId,
      object: "response",
      model: this.model,
      status: "completed",
      output: this.collectedOutput,
      usage: {
        input_tokens: this.inputTokens,
        output_tokens: this.outputTokens,
        total_tokens: this.inputTokens + this.outputTokens,
      },
      created_at: this.createdAt,
      completed_at: completedAt,
    };
    this.pushResponsesSSE(RESPONSES_SSE_EVENTS.COMPLETED, {
      type: RESPONSES_SSE_EVENTS.COMPLETED,
      response,
      sequence_number: this.nextSeq(),
    });
    this.pushDone();
  }

  protected processEvent(event: { event?: string; data?: string }): void {
    let chunk: Record<string, unknown>;
    try { chunk = JSON.parse(event.data!); } catch (err) { this.emit("warning", err); return; }

    // Extract usage when present (usage-only chunks or chunks with usage)
    if (chunk.usage) {
      const usage = chunk.usage as Record<string, number>;
      this.inputTokens = usage.prompt_tokens ?? this.inputTokens;
      this.outputTokens = usage.completion_tokens ?? this.outputTokens;
    }

    // Usage-only chunk (no choices) — may trigger completion
    if (chunk.usage && !(Array.isArray(chunk.choices) && chunk.choices.length > 0)) {
      if (this.pendingCompletion) {
        this.closeAllOpenItems();
        this.emitCompleted();
        this.pendingCompletion = false;
      }
      return;
    }

    const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
    const choice = choices?.[0];
    if (!choice) return;

    const delta = choice.delta as Record<string, unknown> | undefined;

    // First chunk with role → emit response.created + response.in_progress
    if (delta?.role === "assistant") {
      this.ensureResponseCreated();
    }

    // Handle reasoning_content
    if (delta?.reasoning_content != null && delta.reasoning_content !== "") {
      this.ensureResponseCreated();
      // Close message item if open (reasoning comes first, but could be interleaved)
      this.closeCurrentMessageItem();

      if (!this.hasReasoningItemStarted) {
        this.hasReasoningItemStarted = true;
        this.currentReasoningItemId = `rs_${randomHex(ID_HEX_LENGTH)}`;
        this.pushResponsesSSE(RESPONSES_SSE_EVENTS.OUTPUT_ITEM_ADDED, {
          type: RESPONSES_SSE_EVENTS.OUTPUT_ITEM_ADDED,
          output_index: this.outputIndex,
          item: { type: "reasoning", id: this.currentReasoningItemId, summary: [] },
          sequence_number: this.nextSeq(),
        });
        this.pushResponsesSSE(RESPONSES_SSE_EVENTS.REASONING_SUMMARY_PART_ADDED, {
          type: RESPONSES_SSE_EVENTS.REASONING_SUMMARY_PART_ADDED,
          output_index: this.outputIndex,
          summary_index: 0,
          part: { type: "summary_text", text: "" },
          sequence_number: this.nextSeq(),
        });
      }
      this.pushResponsesSSE(RESPONSES_SSE_EVENTS.REASONING_SUMMARY_TEXT_DELTA, {
        type: RESPONSES_SSE_EVENTS.REASONING_SUMMARY_TEXT_DELTA,
        output_index: this.outputIndex,
        summary_index: 0,
        delta: delta.reasoning_content as string,
        sequence_number: this.nextSeq(),
      });
    }

    // Handle text content
    if (delta?.content != null && delta.content !== "") {
      this.ensureResponseCreated();
      // Close reasoning item if transitioning to text
      this.closeCurrentReasoningItem();

      if (!this.hasMessageItemStarted) {
        this.hasMessageItemStarted = true;
        this.contentIndex = 0;
        this.currentMessageItemId = `msg_${randomHex(ID_HEX_LENGTH)}`;
        this.pushResponsesSSE(RESPONSES_SSE_EVENTS.OUTPUT_ITEM_ADDED, {
          type: RESPONSES_SSE_EVENTS.OUTPUT_ITEM_ADDED,
          output_index: this.outputIndex,
          item: {
            type: "message",
            id: this.currentMessageItemId,
            role: "assistant",
            content: [],
            status: "in_progress",
          },
          sequence_number: this.nextSeq(),
        });
      }
      if (!this.hasContentPartStarted) {
        this.hasContentPartStarted = true;
        this.pushResponsesSSE(RESPONSES_SSE_EVENTS.CONTENT_PART_ADDED, {
          type: RESPONSES_SSE_EVENTS.CONTENT_PART_ADDED,
          output_index: this.outputIndex,
          content_index: this.contentIndex,
          part: { type: "output_text", text: "", annotations: [] },
          sequence_number: this.nextSeq(),
        });
      }
      this.pushResponsesSSE(RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DELTA, {
        type: RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DELTA,
        output_index: this.outputIndex,
        content_index: this.contentIndex,
        delta: delta.content as string,
        sequence_number: this.nextSeq(),
      });
    }

    // Handle tool_calls
    const toolCalls = delta?.tool_calls as Array<Record<string, unknown>> | undefined;
    if (toolCalls) {
      this.ensureResponseCreated();
      // Close any open items before starting a tool call
      this.closeCurrentReasoningItem();
      this.closeCurrentMessageItem();

      for (const tc of toolCalls) {
        const fn = tc.function as Record<string, unknown> | undefined;
        const tcId = tc.id as string | undefined;
        const tcName = fn?.name as string | undefined;

        // New tool call (has id + name)
        if (tcId && tcName) {
          // Close previous function call if any
          if (this.currentFunctionCallId) {
            this.closeCurrentFunctionCall();
          }
          this.currentFunctionCallId = tcId;
          this.currentFunctionCallName = tcName;
          this.pushResponsesSSE(RESPONSES_SSE_EVENTS.OUTPUT_ITEM_ADDED, {
            type: RESPONSES_SSE_EVENTS.OUTPUT_ITEM_ADDED,
            output_index: this.outputIndex,
            item: {
              type: "function_call",
              id: tcId,
              call_id: tcId,
              name: tcName,
              arguments: "",
              status: "in_progress",
            },
            sequence_number: this.nextSeq(),
          });
          // Also emit any initial arguments
          const args = fn?.arguments as string | undefined;
          if (args && args !== "") {
            this.pushResponsesSSE(RESPONSES_SSE_EVENTS.FUNCTION_CALL_ARGUMENTS_DELTA, {
              type: RESPONSES_SSE_EVENTS.FUNCTION_CALL_ARGUMENTS_DELTA,
              output_index: this.outputIndex,
              item_id: tcId,
              call_id: tcId,
              delta: args,
              sequence_number: this.nextSeq(),
            });
          }
        } else if (fn?.arguments) {
          // Arguments continuation for current tool call
          this.pushResponsesSSE(RESPONSES_SSE_EVENTS.FUNCTION_CALL_ARGUMENTS_DELTA, {
            type: RESPONSES_SSE_EVENTS.FUNCTION_CALL_ARGUMENTS_DELTA,
            output_index: this.outputIndex,
            item_id: this.currentFunctionCallId,
            call_id: this.currentFunctionCallId,
            delta: fn.arguments as string,
            sequence_number: this.nextSeq(),
          });
        }
      }
    }

    // Handle finish_reason
    const finishReason = choice.finish_reason as string | undefined;
    if (finishReason) {
      this.closeAllOpenItems();
      this.pendingCompletion = true;
      // If there's no usage-only chunk coming, emit completed now
      // Usage chunk may come in a separate chunk or was already in this chunk
      if (chunk.usage) {
        this.emitCompleted();
        this.pendingCompletion = false;
      }
    }
  }

  protected flushPendingData(): void {
    // No buffered data to flush
  }

  protected ensureTerminated(): void {
    if (!this.done) {
      this.ensureResponseCreated();
      this.closeAllOpenItems();
      this.emitCompleted();
    }
  }
}

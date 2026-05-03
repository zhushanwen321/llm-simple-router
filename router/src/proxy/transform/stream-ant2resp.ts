import { randomBytes } from "crypto";
import { BaseSSETransform } from "./stream-transform-base.js";
import { generateRespId } from "./id-utils.js";
import { RESPONSES_SSE_EVENTS } from "./types-responses.js";
import type { ResponsesApiResponse, ResponseOutputItem } from "./types-responses.js";

type Ant2RespState = "init" | "text" | "thinking" | "tool_use" | "closing";

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export class AnthropicToResponsesTransform extends BaseSSETransform {
  private state: Ant2RespState = "init";
  private responseId = generateRespId();
  private outputIndex = 0;
  private sequenceNumber = 0;
  private hasResponseCreated = false;
  private inputTokens = 0;
  private outputTokens = 0;
  private pendingStatus: string | null = null;
  private activeToolCallId = "";
  private collectedOutput: ResponseOutputItem[] = [];
  private currentItemId = "";
  private currentSummaryPartId = "";
  private currentContentPartIndex = 0;
  private createdAt = Math.floor(Date.now() / 1000);

  private nextSeq(): number {
    return this.sequenceNumber++;
  }

  private emitResponseCreated(): void {
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

  protected processEvent(event: { event?: string; data?: string }): void {
    let data: Record<string, unknown>;
    try { data = JSON.parse(event.data!); } catch (err) { this.emit("warning", err); return; }

    switch (data.type) {
      case "message_start": {
        const msg = data.message as Record<string, unknown> | undefined;
        const usage = msg?.usage as Record<string, unknown> | undefined;
        this.inputTokens = (usage?.input_tokens as number) ?? 0;
        this.emitResponseCreated();
        break;
      }

      case "content_block_start": {
        const block = data.content_block as Record<string, unknown>;
        const blockType = block?.type as string;

        if (blockType === "thinking") {
          this.state = "thinking";
          this.currentItemId = `rs_${randomHex(12)}`;
          this.currentSummaryPartId = `sp_${randomHex(8)}`;
          this.pushResponsesSSE(RESPONSES_SSE_EVENTS.OUTPUT_ITEM_ADDED, {
            type: RESPONSES_SSE_EVENTS.OUTPUT_ITEM_ADDED,
            output_index: this.outputIndex,
            item: { type: "reasoning", id: this.currentItemId, summary: [] },
            sequence_number: this.nextSeq(),
          });
          this.pushResponsesSSE(RESPONSES_SSE_EVENTS.REASONING_SUMMARY_PART_ADDED, {
            type: RESPONSES_SSE_EVENTS.REASONING_SUMMARY_PART_ADDED,
            output_index: this.outputIndex,
            summary_index: 0,
            part: { type: "summary_text", text: "" },
            sequence_number: this.nextSeq(),
          });
        } else if (blockType === "text") {
          this.state = "text";
          this.currentItemId = `msg_${randomHex(12)}`;
          this.currentContentPartIndex = 0;
          this.pushResponsesSSE(RESPONSES_SSE_EVENTS.OUTPUT_ITEM_ADDED, {
            type: RESPONSES_SSE_EVENTS.OUTPUT_ITEM_ADDED,
            output_index: this.outputIndex,
            item: { type: "message", id: this.currentItemId, role: "assistant", content: [], status: "in_progress" },
            sequence_number: this.nextSeq(),
          });
          this.pushResponsesSSE(RESPONSES_SSE_EVENTS.CONTENT_PART_ADDED, {
            type: RESPONSES_SSE_EVENTS.CONTENT_PART_ADDED,
            output_index: this.outputIndex,
            content_index: 0,
            part: { type: "output_text", text: "", annotations: [] },
            sequence_number: this.nextSeq(),
          });
        } else if (blockType === "tool_use") {
          this.state = "tool_use";
          const toolId = block.id as string;
          // Convert toolu_ prefix to fc_ prefix
          this.activeToolCallId = toolId.startsWith("toolu_")
            ? `fc_${toolId.slice(6)}`
            : `fc_${randomHex(12)}`;
          const callId = this.activeToolCallId;
          this.currentItemId = callId;
          this.pushResponsesSSE(RESPONSES_SSE_EVENTS.OUTPUT_ITEM_ADDED, {
            type: RESPONSES_SSE_EVENTS.OUTPUT_ITEM_ADDED,
            output_index: this.outputIndex,
            item: {
              type: "function_call",
              id: callId,
              call_id: callId,
              name: block.name as string,
              arguments: "",
              status: "in_progress",
            },
            sequence_number: this.nextSeq(),
          });
        }
        break;
      }

      case "content_block_delta": {
        const delta = data.delta as Record<string, unknown>;
        const deltaType = delta?.type as string;

        if (deltaType === "thinking_delta") {
          const thinking = delta.thinking as string;
          if (thinking) {
            this.pushResponsesSSE(RESPONSES_SSE_EVENTS.REASONING_SUMMARY_TEXT_DELTA, {
              type: RESPONSES_SSE_EVENTS.REASONING_SUMMARY_TEXT_DELTA,
              output_index: this.outputIndex,
              summary_index: 0,
              delta: thinking,
              sequence_number: this.nextSeq(),
            });
          }
        } else if (deltaType === "text_delta") {
          const text = delta.text as string;
          if (text) {
            this.pushResponsesSSE(RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DELTA, {
              type: RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DELTA,
              output_index: this.outputIndex,
              content_index: 0,
              delta: text,
              sequence_number: this.nextSeq(),
            });
          }
        } else if (deltaType === "input_json_delta") {
          const partialJson = delta.partial_json as string;
          if (partialJson) {
            this.pushResponsesSSE(RESPONSES_SSE_EVENTS.FUNCTION_CALL_ARGUMENTS_DELTA, {
              type: RESPONSES_SSE_EVENTS.FUNCTION_CALL_ARGUMENTS_DELTA,
              output_index: this.outputIndex,
              item_id: this.currentItemId,
              call_id: this.activeToolCallId,
              delta: partialJson,
              sequence_number: this.nextSeq(),
            });
          }
        }
        break;
      }

      case "content_block_stop": {
        if (this.state === "thinking") {
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
            item: { type: "reasoning", id: this.currentItemId, summary: [{ type: "summary_text", text: "" }] },
            sequence_number: this.nextSeq(),
          });
          this.collectedOutput.push({ type: "reasoning", id: this.currentItemId, summary: [{ type: "summary_text", text: "" }] });
        } else if (this.state === "text") {
          this.pushResponsesSSE(RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DONE, {
            type: RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DONE,
            output_index: this.outputIndex,
            content_index: 0,
            text: "",
            sequence_number: this.nextSeq(),
          });
          this.pushResponsesSSE(RESPONSES_SSE_EVENTS.CONTENT_PART_DONE, {
            type: RESPONSES_SSE_EVENTS.CONTENT_PART_DONE,
            output_index: this.outputIndex,
            content_index: 0,
            part: { type: "output_text", text: "", annotations: [] },
            sequence_number: this.nextSeq(),
          });
          this.pushResponsesSSE(RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE, {
            type: RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE,
            output_index: this.outputIndex,
            item: { type: "message", id: this.currentItemId, role: "assistant", content: [{ type: "output_text", text: "", annotations: [] }], status: "completed" },
            sequence_number: this.nextSeq(),
          });
          this.collectedOutput.push({
            type: "message", id: this.currentItemId, role: "assistant",
            content: [{ type: "output_text", text: "", annotations: [] }],
          });
        } else if (this.state === "tool_use") {
          this.pushResponsesSSE(RESPONSES_SSE_EVENTS.FUNCTION_CALL_ARGUMENTS_DONE, {
            type: RESPONSES_SSE_EVENTS.FUNCTION_CALL_ARGUMENTS_DONE,
            output_index: this.outputIndex,
            item_id: this.currentItemId,
            call_id: this.activeToolCallId,
            arguments: "",
            sequence_number: this.nextSeq(),
          });
          this.pushResponsesSSE(RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE, {
            type: RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE,
            output_index: this.outputIndex,
            item: {
              type: "function_call", id: this.activeToolCallId,
              call_id: this.activeToolCallId,
              name: "", arguments: "", status: "completed",
            },
            sequence_number: this.nextSeq(),
          });
          this.collectedOutput.push({
            type: "function_call", id: this.activeToolCallId,
            call_id: this.activeToolCallId, name: "", arguments: "",
          });
        }
        this.outputIndex++;
        this.state = "init";
        break;
      }

      case "message_delta": {
        const msgDelta = data.delta as Record<string, unknown>;
        const usage = data.usage as Record<string, unknown> | undefined;
        this.outputTokens = (usage?.output_tokens as number) ?? this.outputTokens;

        const stopReason = msgDelta?.stop_reason as string | undefined;
        if (stopReason === "tool_use") {
          this.pendingStatus = "completed"; // will have function_calls → status remains completed
        } else if (stopReason === "max_tokens") {
          this.pendingStatus = "incomplete";
        } else {
          this.pendingStatus = "completed";
        }
        break;
      }

      case "message_stop": {
        this.emitCompleted();
        break;
      }

      case "error": {
        const error = data.error as Record<string, unknown>;
        this.pushResponsesSSE(RESPONSES_SSE_EVENTS.ERROR, {
          type: "error",
          message: (error?.message as string) ?? "Stream error",
          code: (error?.type as string) ?? "upstream_error",
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

  private emitCompleted(): void {
    const status = this.pendingStatus ?? "completed";
    const completedAt = Math.floor(Date.now() / 1000);
    const response: ResponsesApiResponse = {
      id: this.responseId,
      object: "response",
      model: this.model,
      status: status as ResponsesApiResponse["status"],
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

  protected flushPendingData(): void {
    // No buffered data to flush
  }

  protected ensureTerminated(): void {
    if (!this.done) {
      this.emitResponseCreated();
      this.emitCompleted();
    }
  }
}

import { generateMsgId, generateRespId } from "./id-utils.js";
import { parseToolArguments } from "./sanitize.js";
import type { AnthropicContentBlock, AnthropicThinkingBlock, AnthropicTextBlock, AnthropicToolUseBlock } from "./types.js";
import type {
  ResponsesApiResponse,
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponseFunctionCallOutput,
  ResponseReasoningOutput,
} from "./types-responses.js";

// ---------- Status ↔ stop_reason mapping ----------

const RESP_STATUS_TO_STOP: Record<string, string> = {
  completed: "end_turn",
  incomplete: "max_tokens",
  failed: "end_turn",
};

const ANT_STOP_TO_RESP_STATUS: Record<string, string> = {
  end_turn: "completed",
  stop_sequence: "completed",
  tool_use: "completed",
  max_tokens: "incomplete",
};

/** Responses API status → Anthropic stop_reason */
function mapStatusToStopReason(status: string): string {
  return RESP_STATUS_TO_STOP[status] ?? "end_turn";
}

/** Anthropic stop_reason → Responses API status */
function mapStopReasonToStatus(reason: string): string {
  return ANT_STOP_TO_RESP_STATUS[reason] ?? "completed";
}

// ---------- Responses → Anthropic ----------

export function responsesToAnthropicResponse(bodyStr: string): string {
  const resp = JSON.parse(bodyStr) as ResponsesApiResponse;
  const output = resp.output ?? [];
  const content: Array<Record<string, unknown>> = [];

  for (const item of output) {
    if (item.type === "message") {
      // ResponseOutputMessage → text blocks
      const msg = item as ResponseOutputMessage;
      for (const part of msg.content) {
        if (part.type === "output_text" && part.text != null) {
          content.push({ type: "text", text: part.text });
        }
      }
    } else if (item.type === "function_call") {
      // → tool_use block (Anthropic requires "toolu_" prefix)
      const fc = item as ResponseFunctionCallOutput;
      const rawCallId = fc.call_id ?? "";
      const antId = rawCallId.startsWith("toolu_") ? rawCallId : `toolu_${rawCallId}`;
      content.push({
        type: "tool_use",
        id: antId,
        name: fc.name ?? "",
        input: parseToolArguments(fc.arguments),
      });
    } else if (item.type === "reasoning") {
      // → thinking block
      const rs = item as ResponseReasoningOutput;
      const thinkingText = rs.summary
        ? rs.summary.map(s => s.text ?? "").join("")
        : "";
      content.push({ type: "thinking", thinking: thinkingText });
    }
    // Other output types (web_search_call, etc.) → skip
  }

  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }

  const usage = resp.usage;

  return JSON.stringify({
    id: generateMsgId(),
    type: "message",
    role: "assistant",
    content,
    model: resp.model ?? "",
    stop_reason: mapStatusToStopReason(resp.status ?? "completed"),
    stop_sequence: null,
    usage: {
      input_tokens: usage?.input_tokens ?? 0,
      output_tokens: usage?.output_tokens ?? 0,
    },
  });
}

// ---------- Anthropic → Responses ----------

const TOOLU_PREFIX_LEN = "toolu_".length;

/** Strip "toolu_" prefix from a tool_use_id to recover the original call_id. */
function stripTooluPrefix(id: string): string {
  return id.startsWith("toolu_") ? id.slice(TOOLU_PREFIX_LEN) : id;
}

export function anthropicToResponsesResponse(bodyStr: string): string {
  const ant = JSON.parse(bodyStr) as {
    type?: string;
    role?: string;
    model?: string;
    content?: AnthropicContentBlock[];
    stop_reason?: string;
    usage?: Record<string, unknown>;
  };
  const blocks = ant.content ?? [];
  const output: ResponseOutputItem[] = [];

  for (const block of blocks) {
    if (block.type === "thinking") {
      // → reasoning output
      const tb = block as AnthropicThinkingBlock;
      output.push({
        type: "reasoning",
        id: `rs_${Date.now()}_${output.length}`,
        summary: [{ type: "summary_text", text: tb.thinking ?? "" }],
      });
    } else if (block.type === "text") {
      // → message output
      const tb = block as AnthropicTextBlock;
      output.push({
        type: "message",
        id: generateMsgId(),
        role: "assistant",
        content: [{ type: "output_text", text: tb.text ?? "" }],
      });
    } else if (block.type === "tool_use") {
      // → function_call output
      const tb = block as AnthropicToolUseBlock;
      const callId = stripTooluPrefix(tb.id ?? "");
      output.push({
        type: "function_call",
        id: `fc_${callId}`,
        call_id: callId,
        name: tb.name ?? "",
        arguments: JSON.stringify(tb.input ?? {}),
      });
    }
  }

  // Usage mapping: Anthropic → Responses
  const antUsage = ant.usage as Record<string, unknown> | undefined;
  const inputTokens =
    ((antUsage?.input_tokens as number) ?? 0) +
    ((antUsage?.cache_read_input_tokens as number) ?? 0) +
    ((antUsage?.cache_creation_input_tokens as number) ?? 0);
  const outputTokens = (antUsage?.output_tokens as number) ?? 0;

  return JSON.stringify({
    id: generateRespId(),
    object: "response",
    model: ant.model ?? "",
    status: mapStopReasonToStatus((ant.stop_reason ?? "end_turn") as string),
    output,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  });
}

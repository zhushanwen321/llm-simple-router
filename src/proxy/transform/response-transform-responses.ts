import { generateMsgId, generateRespId } from "./id-utils.js";
import { parseToolArguments } from "./sanitize.js";

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
  const resp = JSON.parse(bodyStr) as Record<string, unknown>;
  const output = (resp.output as Array<Record<string, unknown>>) ?? [];
  const content: Array<Record<string, unknown>> = [];

  for (const item of output) {
    const type = item.type as string;

    if (type === "message") {
      // ResponseOutputMessage → text blocks
      const msgContent = (item.content as Array<Record<string, unknown>>) ?? [];
      for (const part of msgContent) {
        if (part.type === "output_text" && part.text != null) {
          content.push({ type: "text", text: String(part.text) });
        }
      }
    } else if (type === "function_call") {
      // → tool_use block (Anthropic requires "toolu_" prefix)
      const rawCallId = String(item.call_id ?? "");
      const antId = rawCallId.startsWith("toolu_") ? rawCallId : `toolu_${rawCallId}`;
      content.push({
        type: "tool_use",
        id: antId,
        name: String(item.name ?? ""),
        input: parseToolArguments(item.arguments),
      });
    } else if (type === "reasoning") {
      // → thinking block
      const summary = item.summary as Array<Record<string, unknown>> | undefined;
      const thinkingText = summary
        ? summary.map(s => String(s.text ?? "")).join("")
        : "";
      content.push({ type: "thinking", thinking: thinkingText });
    }
    // Other output types (web_search_call, etc.) → skip
  }

  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }

  const usage = resp.usage as Record<string, unknown> | undefined;

  return JSON.stringify({
    id: generateMsgId(),
    type: "message",
    role: "assistant",
    content,
    model: resp.model ?? "",
    stop_reason: mapStatusToStopReason(String(resp.status ?? "completed")),
    stop_sequence: null,
    usage: {
      input_tokens: (usage?.input_tokens as number) ?? 0,
      output_tokens: (usage?.output_tokens as number) ?? 0,
    },
  });
}

// ---------- Anthropic → Responses ----------

/** Strip "toolu_" prefix from a tool_use_id to recover the original call_id. */
function stripTooluPrefix(id: string): string {
  return id.startsWith("toolu_") ? id.slice(6) : id;
}

export function anthropicToResponsesResponse(bodyStr: string): string {
  const ant = JSON.parse(bodyStr) as Record<string, unknown>;
  const blocks = (ant.content as Array<Record<string, unknown>>) ?? [];
  const output: Array<Record<string, unknown>> = [];

  for (const block of blocks) {
    const type = block.type as string;

    if (type === "thinking") {
      // → reasoning output
      output.push({
        type: "reasoning",
        id: `rs_${Date.now()}_${output.length}`,
        summary: [{ type: "summary_text", text: String(block.thinking ?? "") }],
      });
    } else if (type === "text") {
      // → message output
      output.push({
        type: "message",
        id: generateMsgId(),
        role: "assistant",
        content: [{ type: "output_text", text: String(block.text ?? "") }],
      });
    } else if (type === "tool_use") {
      // → function_call output
      const rawId = String(block.id ?? "");
      const callId = stripTooluPrefix(rawId);
      output.push({
        type: "function_call",
        id: `fc_${callId}`,
        call_id: callId,
        name: String(block.name ?? ""),
        arguments: JSON.stringify(block.input ?? {}),
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
    status: mapStopReasonToStatus(String(ant.stop_reason ?? "end_turn")),
    output,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  });
}

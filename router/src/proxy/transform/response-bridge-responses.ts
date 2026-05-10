/**
 * Bridge (lossy) response transformation between OpenAI Responses API
 * and OpenAI Chat Completions API.
 *
 * This is the SECONDARY conversion path used when the upstream provider
 * only supports the opposite API format. It is lossy because Chat Completions
 * cannot represent structured reasoning summaries, built-in tool outputs,
 * or response-level metadata.
 */

import { generateChatcmplId, generateRespId, MS_PER_SECOND } from "./id-utils.js";
import type { OpenAIToolCall } from "./types.js";
import type {
  ResponsesApiResponse,
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponseFunctionCallOutput,
  ResponseReasoningOutput,
} from "./types-responses.js";

// ---------- Responses → Chat Completions ----------

/**
 * Convert a Responses API response body to a Chat Completions response body.
 *
 * Lossy: structured reasoning summaries are flattened to a single string;
 * built-in tool output items (web_search_call, etc.) are skipped.
 */
export function responsesToChatResponse(bodyStr: string): string {
  const resp = JSON.parse(bodyStr) as ResponsesApiResponse;
  const output = resp.output ?? [];

  const message: Record<string, unknown> = { role: "assistant" };
  const toolCalls: Array<Record<string, unknown>> = [];
  const textParts: string[] = [];
  let hasFunctionCall = false;

  for (const item of output) {
    if (item.type === "message") {
      // ResponseOutputMessage → extract text content
      const msg = item as ResponseOutputMessage;
      for (const part of msg.content) {
        if (part.type === "output_text" && part.text != null) {
          textParts.push(part.text);
        }
      }
    } else if (item.type === "function_call") {
      // → tool_calls
      hasFunctionCall = true;
      const fc = item as ResponseFunctionCallOutput;
      toolCalls.push({
        id: fc.call_id ?? fc.id ?? "",
        type: "function",
        function: {
          name: fc.name ?? "",
          arguments: fc.arguments ?? "{}",
        },
      });
    } else if (item.type === "reasoning") {
      // → reasoning_content (joined summary text, LOSSY)
      const rs = item as ResponseReasoningOutput;
      const summary = rs.summary;
      if (summary) {
        const joined = summary.map(s => s.text ?? "").join("");
        if (joined) {
          message.reasoning_content = joined;
        }
      }
    }
    // Other output types (web_search_call, file_search_call, etc.) → skip
  }

  // Text content
  if (textParts.length > 0) {
    message.content = textParts.join("");
  }

  // Tool calls
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  // finish_reason
  let finishReason: string;
  if (hasFunctionCall) {
    finishReason = "tool_calls";
  } else {
    finishReason = mapStatusToFinishReason(resp.status ?? "completed");
  }

  // Usage mapping
  const usage = resp.usage;
  const promptTokens = usage?.input_tokens ?? 0;
  const completionTokens = usage?.output_tokens ?? 0;

  return JSON.stringify({
    id: generateChatcmplId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / MS_PER_SECOND),
    model: resp.model ?? "",
    choices: [{
      index: 0,
      message,
      finish_reason: finishReason,
    }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  });
}

/** Responses API status → Chat Completions finish_reason */
function mapStatusToFinishReason(status: string): string {
  if (status === "incomplete") return "length";
  return "stop";
}

// ---------- Chat Completions → Responses ----------

/**
 * Convert a Chat Completions response body to a Responses API response body.
 *
 * Lossy: Chat Completions has no equivalent for built-in tool output items
 * or structured reasoning summaries.
 */
export function chatToResponsesResponse(bodyStr: string): string {
  const oai = JSON.parse(bodyStr) as {
    id?: string;
    model?: string;
    choices?: Array<{
      index: number;
      message?: {
        role?: string;
        content?: string;
        reasoning_content?: string;
        tool_calls?: OpenAIToolCall[];
      };
      finish_reason?: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const choice = oai.choices?.[0];
  const msg = choice?.message;
  const output: ResponseOutputItem[] = [];

  // reasoning_content → reasoning output
  if (msg?.reasoning_content) {
    output.push({
      type: "reasoning",
      id: `rs_${Date.now()}_0`,
      summary: [{ type: "summary_text", text: msg.reasoning_content }],
    });
  }

  // text content → message output
  if (msg?.content) {
    output.push({
      type: "message",
      id: `msg_${Date.now()}_1`,
      role: "assistant",
      content: [{ type: "output_text", text: msg.content }],
    });
  }

  // tool_calls → function_call output items
  if (msg?.tool_calls) {
    for (let i = 0; i < msg.tool_calls.length; i++) {
      const tc = msg.tool_calls[i];
      output.push({
        type: "function_call",
        id: tc.id ?? `fc_${i}`,
        call_id: tc.id ?? `fc_${i}`,
        name: tc.function.name ?? "",
        arguments: tc.function.arguments ?? "{}",
      });
    }
  }

  // Status mapping
  const finishReason = choice?.finish_reason ?? "stop";
  const status = mapFinishReasonToStatus(finishReason);

  // Usage mapping
  const inputTokens = oai.usage?.prompt_tokens ?? 0;
  const outputTokens = oai.usage?.completion_tokens ?? 0;

  return JSON.stringify({
    id: generateRespId(),
    object: "response",
    model: oai.model ?? "",
    status,
    output,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  });
}

/** Chat Completions finish_reason → Responses API status */
function mapFinishReasonToStatus(reason: string): string {
  if (reason === "length") return "incomplete";
  return "completed"; // "stop", "tool_calls", and unknown → completed
}

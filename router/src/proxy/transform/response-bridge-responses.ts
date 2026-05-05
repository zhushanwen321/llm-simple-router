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

// ---------- Responses → Chat Completions ----------

/**
 * Convert a Responses API response body to a Chat Completions response body.
 *
 * Lossy: structured reasoning summaries are flattened to a single string;
 * built-in tool output items (web_search_call, etc.) are skipped.
 */
export function responsesToChatResponse(bodyStr: string): string {
  const resp = JSON.parse(bodyStr) as Record<string, unknown>;
  const output = (resp.output as Array<Record<string, unknown>>) ?? [];

  const message: Record<string, unknown> = { role: "assistant" };
  const toolCalls: Array<Record<string, unknown>> = [];
  const textParts: string[] = [];
  let hasFunctionCall = false;

  for (const item of output) {
    const type = item.type as string;

    if (type === "message") {
      // ResponseOutputMessage → extract text content
      const msgContent = (item.content as Array<Record<string, unknown>>) ?? [];
      for (const part of msgContent) {
        if (part.type === "output_text" && part.text != null) {
          textParts.push(String(part.text));
        }
      }
    } else if (type === "function_call") {
      // → tool_calls
      hasFunctionCall = true;
      toolCalls.push({
        id: String(item.id ?? ""),
        type: "function",
        function: {
          name: String(item.name ?? ""),
          arguments: String(item.arguments ?? "{}"),
        },
      });
    } else if (type === "reasoning") {
      // → reasoning_content (joined summary text, LOSSY)
      const summary = item.summary as Array<Record<string, unknown>> | undefined;
      if (summary) {
        const joined = summary.map(s => String(s.text ?? "")).join("");
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
    finishReason = mapStatusToFinishReason(String(resp.status ?? "completed"));
  }

  // Usage mapping
  const usage = resp.usage as Record<string, unknown> | undefined;
  const promptTokens = (usage?.input_tokens as number) ?? 0;
  const completionTokens = (usage?.output_tokens as number) ?? 0;

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
  const oai = JSON.parse(bodyStr) as Record<string, unknown>;
  const choices = (oai.choices ?? []) as Array<Record<string, unknown>>;
  const choice = choices[0];
  const msg = choice?.message as Record<string, unknown> | undefined;
  const output: Array<Record<string, unknown>> = [];

  // reasoning_content → reasoning output
  if (msg?.reasoning_content) {
    output.push({
      type: "reasoning",
      id: `rs_${Date.now()}_0`,
      summary: [{ type: "summary_text", text: String(msg.reasoning_content) }],
    });
  }

  // text content → message output
  if (msg?.content) {
    output.push({
      type: "message",
      id: `msg_${Date.now()}_1`,
      role: "assistant",
      content: [{ type: "output_text", text: String(msg.content) }],
    });
  }

  // tool_calls → function_call output items
  const toolCalls = msg?.tool_calls as Array<Record<string, unknown>> | undefined;
  if (toolCalls) {
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      const fn = tc.function as Record<string, unknown> | undefined;
      output.push({
        type: "function_call",
        id: String(tc.id ?? `fc_${i}`),
        call_id: String(tc.id ?? `fc_${i}`),
        name: String(fn?.name ?? ""),
        arguments: String(fn?.arguments ?? "{}"),
      });
    }
  }

  // Status mapping
  const finishReason = String(choice?.finish_reason ?? "stop");
  const status = mapFinishReasonToStatus(finishReason);

  // Usage mapping
  const oaiUsage = oai.usage as Record<string, unknown> | undefined;
  const inputTokens = (oaiUsage?.prompt_tokens as number) ?? 0;
  const outputTokens = (oaiUsage?.completion_tokens as number) ?? 0;

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

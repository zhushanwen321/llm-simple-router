/**
 * Bridge (lossy) request transformation between OpenAI Responses API
 * and OpenAI Chat Completions API.
 *
 * This is the SECONDARY conversion path used when the upstream provider
 * only supports the opposite API format. It is lossy because Chat Completions
 * cannot represent `previous_response_id`, built-in tools, or structured
 * reasoning items.
 */

import type { ChatCompletionMessage, ChatCompletionRequest } from "./types.js";
import type {
  ResponsesApiRequest,
  ResponseInputItem,
  ResponseInputMessage,
} from "./types-responses.js";

// ---------- Responses → Chat Completions ----------

/**
 * Convert an OpenAI Responses API request body to an OpenAI Chat Completions
 * request body.
 */
export function responsesToChatRequest(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const req = body as unknown as ResponsesApiRequest;
  const result: Record<string, unknown> = {};
  result.model = req.model;

  // instructions → system message
  const messages: Array<Record<string, unknown>> = [];
  if (req.instructions != null && req.instructions !== "") {
    messages.push({ role: "system", content: req.instructions });
  }

  // input → messages
  convertResponsesInputToChatMessages(req.input, messages);
  result.messages = messages;

  // max_output_tokens → max_completion_tokens
  if (req.max_output_tokens != null) {
    result.max_completion_tokens = req.max_output_tokens;
  }

  // Pass-through fields
  if (req.temperature != null) result.temperature = req.temperature;
  if (req.top_p != null) result.top_p = req.top_p;
  if (req.stream != null) result.stream = req.stream;

  // tools: Responses format → Chat Completions format
  if (req.tools) {
    const chatTools: Array<Record<string, unknown>> = [];
    for (const t of req.tools) {
      if (t.type === "function") {
        // Responses tools are flat: {type:"function", name, parameters, description}
        // Chat tools need function wrapper: {type:"function", function:{name, parameters}}
        const fn: Record<string, unknown> = { name: t.name };
        if (t.description != null) fn.description = t.description;
        if (t.parameters != null) fn.parameters = t.parameters;
        chatTools.push({ type: "function", function: fn });
      }
      // Non-function tools (web_search_preview, file_search, etc.) → skip
    }
    if (chatTools.length > 0) {
      result.tools = chatTools;
    }
  }

  // tool_choice — compatible between Chat and Responses
  if (req.tool_choice != null) {
    result.tool_choice = req.tool_choice;
  }

  // reasoning — pass through (both use {effort?, max_tokens?})
  if (req.reasoning != null) {
    result.reasoning = req.reasoning;
  }

  // text.format → response_format
  if (req.text?.format != null) {
    result.response_format = req.text.format;
  }

  // stream_options
  if (req.stream_options != null) {
    result.stream_options = req.stream_options;
  }

  return result;
}

/**
 * Convert Responses `input` (string | ResponseInputItem[]) into Chat
 * Completions `messages[]`, appending to the provided array.
 */
function convertResponsesInputToChatMessages(
  input: string | ResponseInputItem[] | undefined,
  messages: Array<Record<string, unknown>>,
): void {
  if (input == null) return;

  // String shorthand → single user message
  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
    return;
  }

  if (!Array.isArray(input)) return;

  // Track pending function_calls to merge into a single assistant message
  const pendingFnCalls: Array<Record<string, unknown>> = [];

  for (const item of input) {
    // Flush any pending function_calls before processing non-function_call items
    if (item.type !== "function_call" && pendingFnCalls.length > 0) {
      flushFunctionCalls(messages, pendingFnCalls);
    }

    switch (item.type) {
      case "message": {
        // ResponseInputMessage → Chat message (discriminated union narrows to ResponseInputMessage)
        const content = extractMessageTextContent(item);
        messages.push({ role: item.role, content });
        break;
      }
      case "input_text":
        messages.push({ role: "user", content: item.text ?? "" });
        break;
      case "function_call": {
        // Collect; will be flushed when next non-function_call item appears or at end of loop
        const fn: Record<string, unknown> = {
          name: item.name ?? "",
          arguments: item.arguments ?? "{}",
        };
        // Responses API function_call uses call_id (not id) as the tool call identifier
        pendingFnCalls.push({
          id: item.call_id ?? item.id ?? "",
          type: "function",
          function: fn,
        });
        break;
      }
      case "function_call_output":
        messages.push({
          role: "tool",
          tool_call_id: item.call_id ?? "",
          content: item.output ?? "",
        });
        break;
      case "reasoning":
        // No Chat Completions equivalent — skip
        break;
      // input_image and unknown item types → skip
    }
  }

  // Flush any remaining pending function_calls
  if (pendingFnCalls.length > 0) {
    flushFunctionCalls(messages, pendingFnCalls);
  }
}

/**
 * Flush accumulated function_call tool_calls into a single assistant message.
 */
function flushFunctionCalls(
  messages: Array<Record<string, unknown>>,
  pending: Array<Record<string, unknown>>,
): void {
  messages.push({
    role: "assistant",
    content: null,
    tool_calls: [...pending],
  });
  pending.length = 0;
}

/**
 * Extract text content from a ResponseInputMessage.
 */
function extractMessageTextContent(msg: ResponseInputMessage): string {
  const content = msg.content;
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.type === "input_text" && p.text != null)
    .map((p) => p.text)
    .join("");
}

// ---------- Chat Completions → Responses ----------

/**
 * Convert an OpenAI Chat Completions request body to an OpenAI Responses API
 * request body.
 */
export function chatToResponsesRequest(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const req = body as unknown as ChatCompletionRequest;
  const result: Record<string, unknown> = {};
  result.model = req.model;

  // Extract instructions from system/developer messages
  const { instructions, nonSystemMsgs } = extractChatInstructions(req.messages ?? []);
  if (instructions) {
    result.instructions = instructions;
  }

  // Convert non-system messages → input items
  result.input = convertChatMessagesToResponsesInput(nonSystemMsgs);

  // max_completion_tokens / max_tokens → max_output_tokens
  if (req.max_completion_tokens != null) {
    result.max_output_tokens = req.max_completion_tokens;
  } else if (req.max_tokens != null) {
    result.max_output_tokens = req.max_tokens;
  }

  // Pass-through fields
  if (req.temperature != null) result.temperature = req.temperature;
  if (req.top_p != null) result.top_p = req.top_p;
  if (req.stream != null) result.stream = req.stream;

  // tools: Chat format → Responses format
  if (req.tools) {
    const respTools: Array<Record<string, unknown>> = [];
    for (const t of req.tools) {
      if (t.type === "function" && t.function) {
        // Chat: {type:"function", function:{name, parameters, description}}
        // Responses: {type:"function", name, parameters, description}
        const fn = t.function;
        const mapped: Record<string, unknown> = {
          type: "function",
          name: fn.name,
        };
        if (fn.description != null) mapped.description = fn.description;
        if (fn.parameters != null) mapped.parameters = fn.parameters;
        respTools.push(mapped);
      }
      // Non-function tools → skip
    }
    if (respTools.length > 0) {
      result.tools = respTools;
    }
  }

  // tool_choice — compatible
  if (req.tool_choice != null) {
    result.tool_choice = req.tool_choice;
  }

  // reasoning — pass through
  if (req.reasoning != null) {
    result.reasoning = req.reasoning;
  }

  // response_format → text.format
  if (req.response_format != null) {
    result.text = { format: req.response_format };
  }

  // stream_options
  if (req.stream_options != null) {
    result.stream_options = req.stream_options;
  }

  return result;
}

/**
 * Extract system/developer messages from Chat messages as instructions.
 */
function extractChatInstructions(
  messages: ChatCompletionMessage[],
): { instructions: string; nonSystemMsgs: ChatCompletionMessage[] } {
  const parts: string[] = [];
  const nonSystemMsgs: ChatCompletionMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system" || msg.role === "developer") {
      parts.push(msg.content ?? "");
    } else {
      nonSystemMsgs.push(msg);
    }
  }

  return {
    instructions: parts.length > 0 ? parts.join("\n") : "",
    nonSystemMsgs,
  };
}

/**
 * Convert Chat Completions non-system messages → Responses input items.
 */
function convertChatMessagesToResponsesInput(
  messages: ChatCompletionMessage[],
): unknown[] {
  const items: unknown[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const text = typeof msg.content === "string" ? msg.content : (msg.content ?? "") as string;
      items.push({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      });
    } else if (msg.role === "assistant") {
      // Text content → assistant message with output_text
      if (msg.content != null && msg.content !== "") {
        const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        items.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text }],
        });
      }

      // tool_calls → function_call items
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          items.push({
            type: "function_call",
            id: tc.id ?? "",
            call_id: tc.id ?? "",
            name: tc.function.name ?? "",
            arguments: tc.function.arguments ?? "{}",
          });
        }
      }
    } else if (msg.role === "tool") {
      items.push({
        type: "function_call_output",
        call_id: msg.tool_call_id ?? "",
        output: msg.content ?? "",
      });
    }
    // reasoning_content in messages → skip (can't create reasoning items)
  }

  return items;
}

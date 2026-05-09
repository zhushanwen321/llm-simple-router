/**
 * Bridge (lossy) request transformation between OpenAI Responses API
 * and OpenAI Chat Completions API.
 *
 * This is the SECONDARY conversion path used when the upstream provider
 * only supports the opposite API format. It is lossy because Chat Completions
 * cannot represent `previous_response_id`, built-in tools, or structured
 * reasoning items.
 */

// ---------- Responses → Chat Completions ----------

/**
 * Convert an OpenAI Responses API request body to an OpenAI Chat Completions
 * request body.
 */
export function responsesToChatRequest(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  result.model = body.model;

  // instructions → system message
  const messages: Array<Record<string, unknown>> = [];
  if (body.instructions != null && body.instructions !== "") {
    messages.push({ role: "system", content: body.instructions });
  }

  // input → messages
  convertResponsesInputToChatMessages(body.input, messages);
  result.messages = messages;

  // max_output_tokens → max_completion_tokens
  if (body.max_output_tokens != null) {
    result.max_completion_tokens = body.max_output_tokens;
  }

  // Pass-through fields
  if (body.temperature != null) result.temperature = body.temperature;
  if (body.top_p != null) result.top_p = body.top_p;
  if (body.stream != null) result.stream = body.stream;

  // tools: Responses format → Chat Completions format
  const tools = body.tools as Array<Record<string, unknown>> | undefined;
  if (tools) {
    const chatTools: Array<Record<string, unknown>> = [];
    for (const t of tools) {
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
  if (body.tool_choice != null) {
    result.tool_choice = body.tool_choice;
  }

  // reasoning — pass through (both use {effort?, max_tokens?})
  if (body.reasoning != null) {
    result.reasoning = body.reasoning;
  }

  // text.format → response_format
  const text = body.text as Record<string, unknown> | undefined;
  if (text?.format != null) {
    result.response_format = text.format;
  }

  // stream_options
  if (body.stream_options != null) {
    result.stream_options = body.stream_options;
  }

  return result;
}

/**
 * Convert Responses `input` (string | ResponseInputItem[]) into Chat
 * Completions `messages[]`, appending to the provided array.
 */
function convertResponsesInputToChatMessages(
  input: unknown,
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

  for (const item of input as Array<Record<string, unknown>>) {
    const type = item.type as string;

    // Flush any pending function_calls before processing non-function_call items
    if (type !== "function_call" && pendingFnCalls.length > 0) {
      flushFunctionCalls(messages, pendingFnCalls);
    }

    if (type === "message") {
      // ResponseInputMessage → Chat message
      const role = item.role as string;
      const content = extractMessageTextContent(item);
      messages.push({ role, content });
    } else if (type === "input_text") {
      messages.push({ role: "user", content: (item.text ?? "") as string });
    } else if (type === "function_call") {
      // Collect; will be flushed when next non-function_call item appears
      // or at end of loop
      const fn: Record<string, unknown> = {
        name: (item.name ?? "") as string,
        arguments: (item.arguments ?? "{}") as string,
      };
      pendingFnCalls.push({
        id: (item.id ?? "") as string,
        type: "function",
        function: fn,
      });
    } else if (type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: (item.call_id ?? "") as string,
        content: (item.output ?? "") as string,
      });
    } else if (type === "reasoning") {
      // No Chat Completions equivalent — skip
    }
    // Unknown item types → skip
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
function extractMessageTextContent(msg: Record<string, unknown>): string {
  const content = msg.content;
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown>>)
      .filter((p) => p.type === "input_text" && p.text != null)
      .map((p) => p.text)
      .join("");
  }
  return "";
}

// ---------- Chat Completions → Responses ----------

/**
 * Convert an OpenAI Chat Completions request body to an OpenAI Responses API
 * request body.
 */
export function chatToResponsesRequest(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  result.model = body.model;

  // Extract instructions from system/developer messages
  const messages = body.messages as Array<Record<string, unknown>> | undefined;
  const { instructions, nonSystemMsgs } = extractChatInstructions(messages ?? []);
  if (instructions) {
    result.instructions = instructions;
  }

  // Convert non-system messages → input items
  result.input = convertChatMessagesToResponsesInput(nonSystemMsgs);

  // max_completion_tokens / max_tokens → max_output_tokens
  if (body.max_completion_tokens != null) {
    result.max_output_tokens = body.max_completion_tokens;
  } else if (body.max_tokens != null) {
    result.max_output_tokens = body.max_tokens;
  }

  // Pass-through fields
  if (body.temperature != null) result.temperature = body.temperature;
  if (body.top_p != null) result.top_p = body.top_p;
  if (body.stream != null) result.stream = body.stream;

  // tools: Chat format → Responses format
  const tools = body.tools as Array<Record<string, unknown>> | undefined;
  if (tools) {
    const respTools: Array<Record<string, unknown>> = [];
    for (const t of tools) {
      if (t.type === "function" && t.function) {
        // Chat: {type:"function", function:{name, parameters, description}}
        // Responses: {type:"function", name, parameters, description}
        const fn = t.function as Record<string, unknown>;
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
  if (body.tool_choice != null) {
    result.tool_choice = body.tool_choice;
  }

  // reasoning — pass through
  if (body.reasoning != null) {
    result.reasoning = body.reasoning;
  }

  // response_format → text.format
  if (body.response_format != null) {
    result.text = { format: body.response_format };
  }

  // stream_options
  if (body.stream_options != null) {
    result.stream_options = body.stream_options;
  }

  return result;
}

/**
 * Extract system/developer messages from Chat messages as instructions.
 */
function extractChatInstructions(
  messages: Array<Record<string, unknown>>,
): { instructions: string; nonSystemMsgs: Array<Record<string, unknown>> } {
  const parts: string[] = [];
  const nonSystemMsgs: Array<Record<string, unknown>> = [];

  for (const msg of messages) {
    const role = msg.role as string;
    if (role === "system" || role === "developer") {
      parts.push((msg.content ?? "") as string);
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
  messages: Array<Record<string, unknown>>,
): unknown[] {
  const items: unknown[] = [];

  for (const msg of messages) {
    const role = msg.role as string;

    if (role === "user") {
      const content = msg.content;
      const text = typeof content === "string" ? content : (content ?? "") as string;
      items.push({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      });
    } else if (role === "assistant") {
      // Text content → assistant message with output_text
      const content = msg.content;
      if (content != null && content !== "" && content !== null) {
        const text = typeof content === "string" ? content : JSON.stringify(content);
        items.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text }],
        });
      }

      // tool_calls → function_call items
      const toolCalls = msg.tool_calls as Array<Record<string, unknown>> | undefined;
      if (toolCalls) {
        for (const tc of toolCalls) {
          const fn = tc.function as Record<string, unknown> | undefined;
          items.push({
            type: "function_call",
            id: (tc.id ?? "") as string,
            call_id: (tc.id ?? "") as string,
            name: (fn?.name ?? ""),
            arguments: (fn?.arguments ?? "{}"),
          });
        }
      }
    } else if (role === "tool") {
      items.push({
        type: "function_call_output",
        call_id: (msg.tool_call_id ?? "") as string,
        output: (msg.content ?? "") as string,
      });
    }
    // reasoning_content in messages → skip (can't create reasoning items)
  }

  return items;
}

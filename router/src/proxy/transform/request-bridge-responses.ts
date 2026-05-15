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

  // tool_choice — normalize {type:"tool"} from Cursor IDE, then pass through
  if (req.tool_choice != null) {
  const tc = req.tool_choice;
  if (typeof tc === "object" && tc !== null) {
    const obj = tc as Record<string, unknown>;
    if (obj.type === "tool" && !obj.name) {
    result.tool_choice = "required";
    } else {
    result.tool_choice = tc;
    }
  } else {
    result.tool_choice = tc;
  }
  }

  // reasoning — pass through (both use {effort?, max_tokens?})
  if (req.reasoning != null) {
    result.reasoning = req.reasoning;
  }

  // text.format → response_format (json_schema 结构差异需转换)
  if (req.text?.format != null) {
  const format = req.text.format as Record<string, unknown>;
  if (format.type === "json_schema") {
    result.response_format = {
    type: "json_schema",
    json_schema: {
      name: format.name ?? "response_schema",
      schema: format.schema ?? {},
      strict: format.strict ?? false,
    },
    };
  } else {
    result.response_format = format;
  }
  }

  // parallel_tool_calls — pass through
  if (req.parallel_tool_calls != null) {
    result.parallel_tool_calls = req.parallel_tool_calls;
  }

  // metadata.user_id → user
  if (req.metadata?.user_id) {
  result.user = req.metadata.user_id;
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

  // Post-process: 确保 system/developer 消息不出现在 assistant(tool_calls) 和 tool 之间
  // Responses API 允许 function_call 和 function_call_output 之间插入 developer 消息，
  // 但 Chat Completions 格式要求 assistant(tool_calls) 后必须紧跟 tool 消息。
  reorderMessagesAroundToolCalls(messages);
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
 * 将 system/developer 消息从 assistant(tool_calls) 和 tool 之间移走。
 *
 * Responses API 允许 function_call 和 function_call_output 之间插入 developer 消息，
 * 但 Chat Completions 格式要求 assistant(tool_calls) 后必须紧跟对应的 tool 消息。
 *
 * 算法：遍历 messages，当发现 assistant(tool_calls) 后紧跟的非 tool 消息时，
 * 收集这些非 tool 消息，跳过后续的 tool 消息，然后在 tool 消息之后插入收集的非 tool 消息。
 */
function reorderMessagesAroundToolCalls(
  messages: Array<Record<string, unknown>>,
): void {
  const toolCallIds = new Set<string>();

  // 先收集所有 assistant tool_calls 的 ID，用于判断 tool 消息是否属于该批次
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      const calls = msg.tool_calls as Array<Record<string, unknown>>;
      for (const tc of calls) {
        if (typeof tc.id === "string") toolCallIds.add(tc.id);
      }
    }
  }

  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    // 找到 assistant(tool_calls) 消息
    if (msg.role === "assistant" && msg.tool_calls) {
      const calls = msg.tool_calls as Array<Record<string, unknown>>;
      const batchIds = new Set(calls.map((tc) => tc.id as string));

      // 检查紧跟的消息是否为 tool 消息
      let j = i + 1;
      const pendingNonTool: Array<Record<string, unknown>> = [];

      while (j < messages.length) {
        const next = messages[j];
        if (next.role === "tool" && batchIds.has(next.tool_call_id as string)) {
          // 这是属于当前 assistant 的 tool 消息，停止扫描
          break;
        }
        if (next.role === "system" || next.role === "developer") {
          // 收集需要延后的 system/developer 消息
          pendingNonTool.push(next);
          j++;
        } else if (next.role === "tool") {
          // 属于其他 assistant 的 tool 消息，停止
          break;
        } else {
          // 其他角色消息（user/assistant），停止
          break;
        }
      }

      if (pendingNonTool.length > 0) {
        // 从 messages 中删除这些非 tool 消息
        messages.splice(i + 1, pendingNonTool.length);
        // 找到属于当前 assistant 的所有 tool 消息的末尾位置
        let toolEnd = i + 1; // splice 后 j 可能已经变了
        while (toolEnd < messages.length) {
          const candidate = messages[toolEnd];
          if (candidate.role === "tool" && batchIds.has(candidate.tool_call_id as string)) {
            toolEnd++;
          } else {
            break;
          }
        }
        // 在 tool 消息之后插入收集的非 tool 消息
        messages.splice(toolEnd, 0, ...pendingNonTool);
        // 跳过处理过的消息
        i = toolEnd + pendingNonTool.length;
        continue;
      }
    }
    i++;
  }
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

  // response_format → text.format (json_schema 结构差异需转换)
  if (req.response_format != null) {
  const rf = req.response_format as Record<string, unknown>;
  if (rf.type === "json_schema" && rf.json_schema) {
    const js = rf.json_schema as Record<string, unknown>;
    result.text = {
    format: {
      type: "json_schema",
      name: js.name ?? "response_schema",
      schema: js.schema,
      strict: js.strict,
    },
    };
  } else if (rf.type === "json_object") {
    result.text = { format: { type: "json_object" } };
  } else {
    result.text = { format: rf };
  }
  }

  // parallel_tool_calls — pass through
  if (req.parallel_tool_calls != null) {
    result.parallel_tool_calls = req.parallel_tool_calls;
  }

  // user → metadata.user_id
  if (req.user) {
  result.metadata = { user_id: req.user };
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
    const raw = msg.content as string | Array<Record<string, unknown>> | null | undefined;
    if (typeof raw === "string") {
      items.push({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: raw }],
      });
    } else if (Array.isArray(raw)) {
      const parts: Array<Record<string, unknown>> = [];
      for (const part of raw) {
        if (typeof part === "object" && part !== null) {
          const p = part as Record<string, unknown>;
          if (p.type === "text" && p.text != null) {
            parts.push({ type: "input_text", text: p.text as string });
          } else if (p.type === "image_url") {
            parts.push({
              type: "input_image",
              image_url: (p.image_url as Record<string, unknown>)?.url ?? "",
            });
          }
        }
      }
      if (parts.length > 0) {
        items.push({ type: "message", role: "user", content: parts });
      }
    } else if (raw != null) {
      items.push({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify(raw) }],
      });
    }
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

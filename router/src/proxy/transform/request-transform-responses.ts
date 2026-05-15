import { sanitizeToolUseId, parseToolArguments } from "./sanitize.js";
import type { AnthropicContentBlock, AnthropicImageBlock, AnthropicMessage, AnthropicRequest } from "./types.js";
import type {
  ResponsesApiRequest,
  ResponseInputItem,
  ResponseInputMessage,
  ResponseTool,
} from "./types-responses.js";

// ---------- Effort → budget mapping (shared with thinking-mapper) ----------

const EFFORT_BUDGET: Record<string, number> = { low: 1024, medium: 8192, high: 32768 };
const DEFAULT_BUDGET = 8192;

// ---------- Internal types ----------

interface AntMessage {
  role: string;
  content: AnthropicContentBlock[];
}

// ---------- Helpers ----------

/** Strip "toolu_" prefix from a tool_use_id to recover the original call_id. */
const TOOLU_PREFIX_LEN = "toolu_".length;

function stripTooluPrefix(id: string): string {
  return id.startsWith("toolu_") ? id.slice(TOOLU_PREFIX_LEN) : id;
}

/** Merge consecutive same-role messages to satisfy Anthropic strict alternation. */
function mergeConsecutiveMessages(msgs: AntMessage[]): AntMessage[] {
  const merged: AntMessage[] = [];
  for (const msg of msgs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === msg.role) {
      prev.content = [...prev.content, ...msg.content];
    } else {
      merged.push({ ...msg, content: [...msg.content] });
    }
  }
  return merged;
}

/** Ensure first message has role "user" (prepend empty user if needed). */
function ensureFirstIsUser(msgs: AntMessage[]): AntMessage[] {
  if (msgs.length > 0 && msgs[0].role !== "user") {
    msgs.unshift({ role: "user", content: [{ type: "text", text: "" }] });
  }
  return msgs;
}

// ---------- Responses → Anthropic ----------

export function responsesToAnthropicRequest(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const req = body as unknown as ResponsesApiRequest;
  const result: Record<string, unknown> = {};
  result.model = req.model;

  // input → messages (同时收集 developer/system 消息作为 system 的一部分)
  const { messages: antMessages, systemParts } = convertResponsesInputToAntMessages(req.input);
  result.messages = antMessages;

  // instructions + developer/system 消息合并为 system
  const allSystemParts: string[] = [];
  if (req.instructions != null && req.instructions !== "") {
    allSystemParts.push(req.instructions);
  }
  allSystemParts.push(...systemParts);
  if (allSystemParts.length > 0) {
    result.system = allSystemParts.join("\n");
  }

  // max_output_tokens → max_tokens
  if (req.max_output_tokens != null) {
    result.max_tokens = req.max_output_tokens;
  }

  // temperature, top_p, stream — pass through
  if (req.temperature != null) result.temperature = req.temperature;
  if (req.top_p != null) result.top_p = req.top_p;
  if (req.stream != null) result.stream = req.stream;

  // tools: only function-type tools are forwarded
  if (req.tools) {
    const fnTools = req.tools.filter((t): t is Extract<ResponseTool, { type: "function" }> => t.type === "function");
    if (fnTools.length > 0 && req.tool_choice !== "none") {
      result.tools = fnTools.map(t => {
        const mapped: Record<string, unknown> = { name: t.name };
        if (t.description != null) mapped.description = t.description;
        if (t.parameters != null) mapped.input_schema = t.parameters;
        return mapped;
      });

      // tool_choice mapping
      if (req.tool_choice != null) {
        const tc = mapToolChoiceResponses2Ant(req.tool_choice);
        if (tc != null) {
          result.tool_choice = req.parallel_tool_calls === false
            ? { ...(tc as Record<string, unknown>), disable_parallel_tool_use: true }
            : tc;
        }
      } else if (req.parallel_tool_calls === false) {
        result.tool_choice = { type: "auto", disable_parallel_tool_use: true };
      }
    }
  }

  // reasoning → thinking
  if (req.reasoning) {
    const budget = req.reasoning.max_tokens ?? EFFORT_BUDGET[req.reasoning.effort ?? ""] ?? DEFAULT_BUDGET;
    result.thinking = { type: "enabled", budget_tokens: budget };

    // Ensure max_tokens >= budget_tokens
    if (result.max_tokens != null && (result.max_tokens as number) < budget) {
      result.max_tokens = budget;
    }
  }

  // metadata.user_id
  if (req.metadata?.user_id) {
    result.metadata = { user_id: req.metadata.user_id };
  }

  return result;
}

/** Convert Responses input (string | ResponseInputItem[]) → Anthropic messages + system parts. */
function convertResponsesInputToAntMessages(input: string | ResponseInputItem[] | undefined): { messages: AntMessage[]; systemParts: string[] } {
  if (input == null) return { messages: [], systemParts: [] };
  // String shorthand → single user message
  if (typeof input === "string") {
    return { messages: [{ role: "user", content: [{ type: "text", text: input }] }], systemParts: [] };
  }
  if (!Array.isArray(input)) return { messages: [], systemParts: [] };

  const raw: AntMessage[] = [];
  const systemParts: string[] = [];

  for (const item of input) {
    if (item.type === "message") {
    // developer/system 消息提取为 system part，不放入 messages
      if (item.role === "developer" || item.role === "system") {
        const content = extractMessageContent(item);
        const text = content.map(b => b.type === "text" ? b.text : "").join("");
        if (text) systemParts.push(text);
        continue;
      }
      const content = extractMessageContent(item);
      raw.push({ role: item.role, content });
    } else if (item.type === "function_call") {
      // item is narrowed to ResponseFunctionCallInput
      const rawId = item.call_id ?? item.id ?? "";
      const antId = rawId.startsWith("toolu_") ? rawId : `toolu_${rawId}`;
      raw.push({
        role: "assistant",
        content: [{
          type: "tool_use",
          id: sanitizeToolUseId(antId),
          name: item.name ?? "",
          input: parseToolArguments(item.arguments),
        }],
      });
    } else if (item.type === "function_call_output") {
      // item is narrowed to ResponseFunctionCallOutputInput
      const antCallId = item.call_id.startsWith("toolu_") ? item.call_id : `toolu_${item.call_id}`;
      raw.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: sanitizeToolUseId(antCallId),
          content: item.output ?? "",
        }],
      });
    } else if (item.type === "reasoning") {
    // item is narrowed to ResponseReasoningInput
      const thinkingText = item.summary
        ? item.summary.map(s => s.text ?? "").join("\n")
        : "";
      const content: AnthropicContentBlock[] = [];
      if (thinkingText) {
        content.push({ type: "thinking", thinking: thinkingText });
      }
      // encrypted_content → redacted_thinking（extended thinking 多轮回传关键数据）
      if (item.encrypted_content) {
        content.push({
          type: "redacted_thinking",
          data: item.encrypted_content,
        } as unknown as AnthropicContentBlock);
      }
      if (content.length === 0) {
        content.push({ type: "thinking", thinking: "" });
      }
      raw.push({
        role: "assistant",
        content,
      });
    } else if (item.type === "input_text") {
    // item is narrowed to ResponseInputText
      raw.push({
        role: "user",
        content: [{ type: "text", text: item.text ?? "" }],
      });
    } else if (item.type === "input_image") {
      raw.push({
        role: "user",
        content: [{
          type: "image",
          source: { type: "url", url: item.image_url },
        }],
      });
    }
  }

  const merged = mergeConsecutiveMessages(raw);
  ensureFirstIsUser(merged);
  return { messages: merged, systemParts };
}

/** Extract content blocks from a ResponseInputMessage. */
function extractMessageContent(msg: ResponseInputMessage): AnthropicContentBlock[] {
  const { content } = msg;
  if (content == null) return [];
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  if (Array.isArray(content)) {
    return content.flatMap((part): AnthropicContentBlock[] => {
      if (part.type === "input_text" && part.text != null) {
        return [{ type: "text", text: part.text }];
      }
      if (part.type === "input_image" && part.image_url != null) {
        return [{ type: "image", source: { type: "url", url: part.image_url } }];
      }
      return [];
    });
  }
  return [];
}

/** Map Responses tool_choice → Anthropic tool_choice. */
function mapToolChoiceResponses2Ant(tc: unknown): Record<string, unknown> | undefined {
  if (tc === "auto") return { type: "auto" };
  if (tc === "required") return { type: "any" };
  if (tc === "none") return undefined;
  if (typeof tc === "object" && tc !== null) {
    const obj = tc as Record<string, unknown>;
    if (obj.type === "function" && obj.name) {
      return { type: "tool", name: obj.name };
    }
    // Handle {type:"tool"} without name (Cursor IDE format) → use any tool
    if (obj.type === "tool") {
      return { type: "any" };
    }
  }
  return { type: "auto" };
}

// ---------- Anthropic → Responses ----------

export function anthropicToResponsesRequest(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const req = body as unknown as AnthropicRequest;
  const result: Record<string, unknown> = {};
  result.model = req.model;

  // system → instructions
  if (req.system != null) {
    if (typeof req.system === "string") {
      result.instructions = req.system;
    } else if (Array.isArray(req.system)) {
      result.instructions = req.system.map(b => b.text ?? "").join("\n");
    } else {
      result.instructions = req.system;
    }
  }

  // messages → input items
  result.input = req.messages ? convertAntMessagesToResponsesInput(req.messages) : [];

  // max_tokens → max_output_tokens
  if (req.max_tokens != null) result.max_output_tokens = req.max_tokens;

  // temperature, top_p, stream — pass through
  if (req.temperature != null) result.temperature = req.temperature;
  if (req.top_p != null) result.top_p = req.top_p;
  if (req.stream != null) result.stream = req.stream;

  // tools
  if (req.tools && req.tools.length > 0) {
    result.tools = req.tools.map(t => {
      const mapped: Record<string, unknown> = {
        type: "function",
        name: t.name,
      };
      if (t.description != null) mapped.description = t.description;
      if (t.input_schema != null) mapped.parameters = t.input_schema;
      return mapped;
    });
  }

  // tool_choice
  if (req.tool_choice != null) {
    const tc = mapToolChoiceAnt2Responses(req.tool_choice);
    if (tc != null) result.tool_choice = tc;
  }

  // thinking → reasoning
  if (req.thinking) {
    if (req.thinking.type === "enabled" && req.thinking.budget_tokens != null) {
      result.reasoning = { max_tokens: req.thinking.budget_tokens };
    }
  }

  // metadata.user_id
  if (req.metadata?.user_id) {
    result.metadata = { user_id: req.metadata.user_id };
  }

  return result;
}

/** Convert Anthropic messages → Responses input items. */
function convertAntMessagesToResponsesInput(
  messages: AnthropicMessage[],
): unknown[] {
  const items: unknown[] = [];

  for (const msg of messages) {
    const { role, content } = msg;
    if (!content || !Array.isArray(content)) continue;

    if (role === "user") {
      // Separate text blocks and tool_result blocks
    const textBlocks = content.filter((b): b is Extract<AnthropicContentBlock, { type: "text" }> => b.type === "text");
    const toolResultBlocks = content.filter((b): b is Extract<AnthropicContentBlock, { type: "tool_result" }> => b.type === "tool_result");
    const imageBlocks = content.filter((b): b is AnthropicImageBlock => b.type === "image");

    // Build user message content parts: text + images
    const userParts: Array<Record<string, unknown>> = [];
    if (textBlocks.length > 0) {
    const text = textBlocks.map(b => b.text ?? "").join("");
    userParts.push({ type: "input_text", text });
    }
    for (const img of imageBlocks) {
    const src = img.source;
    const imageUrl = src.type === "url"
      ? (src.url ?? "")
      : `data:${src.media_type ?? "image/png"};base64,${src.data ?? ""}`;
    userParts.push({ type: "input_image", image_url: imageUrl });
    }
    if (userParts.length > 0) {
    items.push({
      type: "message",
      role: "user",
      content: userParts,
    });
    }

    for (const tr of toolResultBlocks) {
    items.push({
      type: "function_call_output",
      call_id: stripTooluPrefix(tr.tool_use_id ?? ""),
      output: tr.content ?? "",
    });
    }
    } else if (role === "assistant") {
      const textBlocks = content.filter((b): b is Extract<AnthropicContentBlock, { type: "text" }> => b.type === "text");
      const toolUseBlocks = content.filter((b): b is Extract<AnthropicContentBlock, { type: "tool_use" }> => b.type === "tool_use");
      const thinkingBlocks = content.filter((b): b is Extract<AnthropicContentBlock, { type: "thinking" }> => b.type === "thinking");

      // thinking → reasoning items
      for (const tb of thinkingBlocks) {
        items.push({
          type: "reasoning",
          id: `rs_${Date.now()}_${items.length}`,
          summary: [{ type: "summary_text", text: tb.thinking ?? "" }],
        });
      }

      // redacted_thinking → reasoning items with encrypted_content
      for (const block of content) {
        const raw = block as unknown as { type: string; data?: string };
        if (raw.type === "redacted_thinking" && raw.data != null) {
          items.push({
            type: "reasoning",
            id: `rs_${Date.now()}_${items.length}`,
            encrypted_content: raw.data,
          });
        }
      }

      // text → assistant message
      if (textBlocks.length > 0) {
        const text = textBlocks.map(b => b.text ?? "").join("");
        items.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text }],
        });
      }

      // tool_use → function_call
      for (const tu of toolUseBlocks) {
        items.push({
          type: "function_call",
          id: tu.id ?? "",
          call_id: stripTooluPrefix(tu.id ?? ""),
          name: tu.name ?? "",
          arguments: JSON.stringify(tu.input ?? {}),
        });
      }
    }
  }

  return items;
}

/** Map Anthropic tool_choice → Responses tool_choice. */
function mapToolChoiceAnt2Responses(tc: unknown): unknown {
  if (typeof tc === "string") {
    if (tc === "auto") return "auto";
    if (tc === "any") return "required";
    return "auto";
  }
  if (typeof tc === "object" && tc !== null) {
    const obj = tc as Record<string, unknown>;
    if (obj.type === "auto") return "auto";
    if (obj.type === "any") return "required";
    if (obj.type === "tool" && obj.name) {
      return { type: "function", name: obj.name };
    }
  }
  return "auto";
}

import { sanitizeToolUseId, parseToolArguments } from "./sanitize.js";
import type { AnthropicContentBlock } from "./types.js";

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
  const result: Record<string, unknown> = {};
  result.model = body.model;

  // instructions → system
  if (body.instructions != null) {
    result.system = body.instructions;
  }

  // input → messages
  result.messages = convertResponsesInputToAntMessages(body.input);

  // max_output_tokens → max_tokens
  if (body.max_output_tokens != null) {
    result.max_tokens = body.max_output_tokens;
  }

  // temperature, top_p, stream — pass through
  if (body.temperature != null) result.temperature = body.temperature;
  if (body.top_p != null) result.top_p = body.top_p;
  if (body.stream != null) result.stream = body.stream;

  // tools: only function-type tools are forwarded
  const tools = body.tools as Array<Record<string, unknown>> | undefined;
  if (tools) {
    const fnTools = tools.filter(t => t.type === "function");
    if (fnTools.length > 0 && body.tool_choice !== "none") {
      result.tools = fnTools.map(t => {
        const mapped: Record<string, unknown> = { name: t.name };
        if (t.description != null) mapped.description = t.description;
        if (t.parameters != null) mapped.input_schema = t.parameters;
        return mapped;
      });

      // tool_choice mapping
      if (body.tool_choice != null && body.tool_choice !== "none") {
        const tc = mapToolChoiceResponses2Ant(body.tool_choice);
        if (tc != null) {
          result.tool_choice = body.parallel_tool_calls === false
            ? { ...(tc as Record<string, unknown>), disable_parallel_tool_use: true }
            : tc;
        }
      } else if (body.parallel_tool_calls === false) {
        result.tool_choice = { type: "auto", disable_parallel_tool_use: true };
      }
    }
  }

  // reasoning → thinking
  if (body.reasoning) {
    const reasoning = body.reasoning as Record<string, unknown>;
    const effort = reasoning.effort as string | undefined;
    const maxTokens = reasoning.max_tokens as number | undefined;
    const budget = maxTokens ?? EFFORT_BUDGET[effort ?? ""] ?? DEFAULT_BUDGET;
    result.thinking = { type: "enabled", budget_tokens: budget };

    // Ensure max_tokens >= budget_tokens
    if (result.max_tokens != null && (result.max_tokens as number) < budget) {
      result.max_tokens = budget;
    }
  }

  // metadata.user_id
  const meta = body.metadata as Record<string, unknown> | undefined;
  if (meta?.user_id) {
    result.metadata = { user_id: meta.user_id };
  }

  return result;
}

/** Convert Responses input (string | ResponseInputItem[]) → Anthropic messages. */
function convertResponsesInputToAntMessages(input: unknown): AntMessage[] {
  if (input == null) return [];
  // String shorthand → single user message
  if (typeof input === "string") {
    return [{ role: "user", content: [{ type: "text", text: input }] }];
  }
  if (!Array.isArray(input)) return [];

  const raw: AntMessage[] = [];

  for (const item of input as Array<Record<string, unknown>>) {
    const type = item.type as string;

    if (type === "message") {
      // ResponseInputMessage: extract content as AnthropicContentBlock[]
      const role = item.role as string;
      const content = extractMessageContent(item);
      raw.push({ role, content });
    } else if (type === "function_call") {
      // → assistant tool_use (Anthropic requires "toolu_" prefix)
      const rawId = (item.call_id ?? item.id ?? "") as string;
      const antId = rawId.startsWith("toolu_") ? rawId : `toolu_${rawId}`;
      raw.push({
        role: "assistant",
        content: [{
          type: "tool_use",
          id: sanitizeToolUseId(antId),
          name: (item.name ?? "") as string,
          input: parseToolArguments(item.arguments),
        }],
      });
    } else if (type === "function_call_output") {
      // → user tool_result (Anthropic requires "toolu_" prefix)
      const rawCallId = (item.call_id ?? "") as string;
      const antCallId = rawCallId.startsWith("toolu_") ? rawCallId : `toolu_${rawCallId}`;
      raw.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: sanitizeToolUseId(antCallId),
          content: (item.output ?? "") as string,
        }],
      });
    } else if (type === "reasoning") {
      // → assistant thinking
      const summary = item.summary as Array<Record<string, unknown>> | undefined;
      const thinkingText = summary
        ? summary.map(s => (s.text ?? "") as string).join("\n")
        : "";
      raw.push({
        role: "assistant",
        content: [{ type: "thinking", thinking: thinkingText }],
      });
    } else if (type === "input_text") {
      // → user text
      raw.push({
        role: "user",
        content: [{ type: "text", text: (item.text ?? "") as string }],
      });
    }
  }

  const merged = mergeConsecutiveMessages(raw);
  ensureFirstIsUser(merged);
  return merged;
}

/** Extract content blocks from a ResponseInputMessage. */
function extractMessageContent(msg: Record<string, unknown>): AnthropicContentBlock[] {
  const content = msg.content;
  if (content == null) return [];
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown>>).flatMap((part): AnthropicContentBlock[] => {
      if (part.type === "input_text" && part.text != null) {
        return [{ type: "text", text: part.text as string }];
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
  }
  return { type: "auto" };
}

// ---------- Anthropic → Responses ----------

export function anthropicToResponsesRequest(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  result.model = body.model;

  // system → instructions
  if (body.system != null) {
    if (typeof body.system === "string") {
      result.instructions = body.system;
    } else if (Array.isArray(body.system)) {
      result.instructions = (body.system as Array<Record<string, unknown>>)
        .map(b => (b.text ?? "") as string)
        .join("\n");
    } else {
      result.instructions = body.system;
    }
  }

  // messages → input items
  const antMessages = body.messages as Array<Record<string, unknown>> | undefined;
  result.input = antMessages ? convertAntMessagesToResponsesInput(antMessages) : [];

  // max_tokens → max_output_tokens
  if (body.max_tokens != null) result.max_output_tokens = body.max_tokens;

  // temperature, top_p, stream — pass through
  if (body.temperature != null) result.temperature = body.temperature;
  if (body.top_p != null) result.top_p = body.top_p;
  if (body.stream != null) result.stream = body.stream;

  // tools
  const tools = body.tools as Array<Record<string, unknown>> | undefined;
  if (tools && tools.length > 0) {
    result.tools = tools.map(t => {
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
  if (body.tool_choice != null) {
    const tc = mapToolChoiceAnt2Responses(body.tool_choice);
    if (tc != null) result.tool_choice = tc;
  }

  // thinking → reasoning
  if (body.thinking) {
    const thinking = body.thinking as Record<string, unknown>;
    if (thinking.type === "enabled" && thinking.budget_tokens != null) {
      result.reasoning = { max_tokens: thinking.budget_tokens };
    }
  }

  // metadata.user_id
  const meta = body.metadata as Record<string, unknown> | undefined;
  if (meta?.user_id) {
    result.metadata = { user_id: meta.user_id };
  }

  return result;
}

/** Convert Anthropic messages → Responses input items. */
function convertAntMessagesToResponsesInput(
  messages: Array<Record<string, unknown>>,
): unknown[] {
  const items: unknown[] = [];

  for (const msg of messages) {
    const role = msg.role as string;
    const content = msg.content as Array<Record<string, unknown>> | undefined;
    if (!content || !Array.isArray(content)) continue;

    if (role === "user") {
      // Separate text blocks and tool_result blocks
      const textBlocks = content.filter(b => b.type === "text");
      const toolResultBlocks = content.filter(b => b.type === "tool_result");

      if (textBlocks.length > 0) {
        const text = textBlocks.map(b => (b.text ?? "") as string).join("");
        items.push({
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        });
      }
      for (const tr of toolResultBlocks) {
        items.push({
          type: "function_call_output",
          call_id: stripTooluPrefix((tr.tool_use_id ?? "") as string),
          output: (tr.content ?? "") as string,
        });
      }
    } else if (role === "assistant") {
      const textBlocks = content.filter(b => b.type === "text");
      const toolUseBlocks = content.filter(b => b.type === "tool_use");
      const thinkingBlocks = content.filter(b => b.type === "thinking");

      // thinking → reasoning items
      for (const tb of thinkingBlocks) {
        items.push({
          type: "reasoning",
          id: `rs_${Date.now()}_${items.length}`,
          summary: [{ type: "summary_text", text: (tb.thinking ?? "") as string }],
        });
      }

      // text → assistant message
      if (textBlocks.length > 0) {
        const text = textBlocks.map(b => (b.text ?? "") as string).join("");
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
          id: (tu.id ?? "") as string,
          call_id: stripTooluPrefix((tu.id ?? "") as string),
          name: (tu.name ?? "") as string,
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

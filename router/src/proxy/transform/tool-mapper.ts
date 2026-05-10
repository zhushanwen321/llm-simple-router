import type { ChatCompletionTool } from "./types.js";

/** OpenAI tools[] → Anthropic tools[] */
export function convertToolsOA2Ant(tools: ChatCompletionTool[]): unknown[] {
  return tools.map((t) => {
    const result: Record<string, unknown> = { name: t.function.name };
    if (t.function.description != null) result.description = t.function.description;
    if (t.function.parameters != null) result.input_schema = t.function.parameters;
    return result;
  });
}

/** Anthropic tools[] → OpenAI tools[] */
export function convertToolsAnt2OA(tools: unknown[]): unknown[] {
  return tools.map((t) => {
    const tool = t as { name: string; description?: string; input_schema?: Record<string, unknown> };
    return {
      type: "function",
      function: {
        name: tool.name,
        ...(tool.description != null ? { description: tool.description } : {}),
        ...(tool.input_schema != null ? { parameters: tool.input_schema } : {}),
      },
    };
  });
}

/** OpenAI tool_choice → Anthropic tool_choice */
export function mapToolChoiceOA2Ant(tc: unknown): unknown {
  if (tc === "none") return undefined;
  if (tc === "auto") return { type: "auto" };
  if (tc === "required") return { type: "any" };
  if (typeof tc === "object" && tc !== null) {
    const obj = tc as { type?: string; function?: { name?: string } };
    if (obj.type === "function" && obj.function) {
      return { type: "tool", name: obj.function.name };
    }
  }
  return { type: "auto" };
}

/** Anthropic tool_choice → OpenAI tool_choice */
export function mapToolChoiceAnt2OA(tc: unknown): unknown {
  if (typeof tc === "string") {
    if (tc === "auto") return "auto";
    if (tc === "any") return "required";
    return "auto";
  }
  if (typeof tc === "object" && tc !== null) {
    const obj = tc as { type?: string; name?: string; disable_parallel_tool_use?: boolean };
    if (obj.type === "auto") {
      if (obj.disable_parallel_tool_use) return { type: "auto", parallel_tool_calls: false };
      return "auto";
    }
    if (obj.type === "any") return "required";
    if (obj.type === "tool") return { type: "function", function: { name: obj.name } };
  }
  return "auto";
}

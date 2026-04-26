/**
 * 将 Anthropic 格式的 tools 转换为 OpenAI 格式。
 *
 * Anthropic: {name, description, input_schema, type?, cache_control?}
 * OpenAI:    {type: "function", function: {name, description, parameters}}
 *
 * 某些 Anthropic 兼容代理（如 opencode）内部转发到 OpenAI 兼容模型时
 * 未正确转换 tools 格式，在上游预先转换可绕过此 bug。
 */

type Tool = Record<string, unknown>;

export function patchToolsFormat(body: Record<string, unknown>): void {
  const tools = body.tools;
  if (!Array.isArray(tools) || tools.length === 0) return;

  body.tools = tools.map((t) => {
    if (!isPlainObject(t)) return t;
    // 已是 OpenAI 格式则跳过
    if (isOpenAITool(t)) return t;
    // Anthropic 格式则转换
    if (isAnthropicTool(t)) return anthropicToOpenAI(t);
    return t;
  });
}

function isPlainObject(v: unknown): v is Tool {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isOpenAITool(t: Tool): boolean {
  const fn = t["function"];
  return typeof fn === "object" && fn !== null && "name" in (fn as Tool);
}

function isAnthropicTool(t: Tool): boolean {
  return typeof t["name"] === "string";
}

function anthropicToOpenAI(tool: Tool): Tool {
  const fn: Tool = { name: tool["name"] as string };
  if (typeof tool["description"] === "string") fn["description"] = tool["description"];
  if (isPlainObject(tool["input_schema"])) fn["parameters"] = tool["input_schema"];
  return { type: "function", function: fn };
}

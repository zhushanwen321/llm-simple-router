const MODEL_MAX_LEN = 128;
const MODEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;

/** synthetic tool_use 的 ID 前缀，用于识别 model 选择的 AskUserQuestion 响应 */
export const TOOL_USE_ID_PREFIX = "toolu_router_";
/** synthetic tool_use 的 ID 前缀，用于识别 provider 选择的 AskUserQuestion 响应（两步式） */
export const TOOL_USE_ID_PROVIDER_PREFIX = "toolu_router_prov_";

function isValidModelName(name: string): boolean {
  return name.length <= MODEL_MAX_LEN && MODEL_RE.test(name) && !/^\d+$/.test(name);
}

export interface DirectiveParseResult {
  modelName: string | null;
  command: string | null;
  cleanedBody: Record<string, unknown>;
  isCommandMessage: boolean;
}

export function parseDirective(
  body: Record<string, unknown>
): DirectiveParseResult {
  const messages = body.messages as
    | Array<{ role: string; content: unknown }>
    | undefined;
  if (!messages?.length) {
    return {
      modelName: null,
      command: null,
      cleanedBody: body,
      isCommandMessage: false,
    };
  }

  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) {
    return {
      modelName: null,
      command: null,
      cleanedBody: body,
      isCommandMessage: false,
    };
  }

  // Deep clone to avoid mutating the original request body
  const cleanedBody = JSON.parse(JSON.stringify(body));
  const cleanedMessages = cleanedBody.messages as Array<{
    role: string;
    content: unknown;
  }>;
  const lastUser = cleanedMessages[lastUserIdx];
  const content = Array.isArray(lastUser.content)
    ? lastUser.content
    : [lastUser.content];

  let modelName: string | null = null;
  let command: string | null = null;
  let isCommandMessage = false;

  const reInline = /\$SELECT-MODEL=([a-zA-Z0-9._:-]+)/g;
  const reModelTag = /\[router-model:\s*([a-zA-Z0-9._\/:-]+)\s*\]/g;
  const reCommand = /\[router-command:\s*(\S+(?:\s+\S+)?)\s*\]/g;

  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: string };
    if (b.type !== "text" || !b.text) continue;

    let text = b.text;

    const cmdMatch = reCommand.exec(text);
    if (cmdMatch) {
      command = cmdMatch[1];
      isCommandMessage = true;
      text = text.replace(reCommand, "").trim();
    }

    const inlineMatch = reInline.exec(text);
    if (inlineMatch && isValidModelName(inlineMatch[1])) {
      modelName = inlineMatch[1];
      text = text.replace(reInline, "").trim();
    }

    const modelTagMatch = reModelTag.exec(text);
    if (modelTagMatch && isValidModelName(modelTagMatch[1])) {
      modelName = modelTagMatch[1];
      text = text.replace(reModelTag, "").trim();
    }

    b.text = text;
  }

  return { modelName, command, cleanedBody, isCommandMessage };
}

export interface ToolResultParseResult {
  isRouterToolResult: boolean;
  selectedModel: string | null;
  /** true = 用户选择了 provider（两步式第一步） */
  isProviderSelection: boolean;
  /** 所有答案（多问题时可从中查找非"不选择"的回答） */
  allAnswers: string[];
}

/**
 * 检测请求中是否包含对 router synthetic AskUserQuestion 的 tool_result 回调，
 * 如果是，从中提取用户选择的模型名或 provider 名。
 */
export function parseToolResult(body: Record<string, unknown>): ToolResultParseResult {
  const empty = { isRouterToolResult: false, selectedModel: null, isProviderSelection: false, allAnswers: [] as string[] };
  const messages = body.messages as
    | Array<{ role: string; content: unknown }>
    | undefined;
  if (!messages?.length) return empty;

  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") { lastUserIdx = i; break; }
  }
  if (lastUserIdx < 0) return empty;

  const lastUser = messages[lastUserIdx];
  const blocks = Array.isArray(lastUser.content) ? lastUser.content : [lastUser.content];

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; tool_use_id?: string; content?: unknown };
    if (b.type !== "tool_result" || typeof b.tool_use_id !== "string") continue;

    const isProviderSelection = b.tool_use_id.startsWith(TOOL_USE_ID_PROVIDER_PREFIX);
    // provider 前缀也以 toolu_router_ 开头，因此先检查 provider 前缀
    const isRouterToolResult = isProviderSelection || b.tool_use_id.startsWith(TOOL_USE_ID_PREFIX);
    if (!isRouterToolResult) continue;

    // 支持 string 和 content blocks 数组两种格式
    let text = "";
    if (typeof b.content === "string") {
      text = b.content;
    } else if (Array.isArray(b.content)) {
      text = (b.content as Array<Record<string, unknown>>)
        .filter(c => c?.type === "text" && typeof c.text === "string")
        .map(c => c.text as string)
        .join("\n");
    }
    const answers: string[] = [];
    let match: RegExpExecArray | null;
    // 宽松匹配：提取所有 ="answer" 对（Claude Code 格式: "question"="answer". ）
    const re = /="([^"]+)"/g;
    while ((match = re.exec(text)) !== null) {
      answers.push(match[1]);
    }
    // Fallback: 尝试从 JSON {"question": "answer", ...} 提取
    if (answers.length === 0 && text.startsWith("{")) {
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed === "object" && parsed !== null) {
          for (const v of Object.values(parsed as Record<string, unknown>)) {
            if (typeof v === "string") answers.push(v);
          }
        }
      } catch { /* not JSON */ }
    }
    const selectedModel = answers.length > 0 ? answers[0] : null;
    return { isRouterToolResult: true, selectedModel, isProviderSelection, allAnswers: answers };
  }

  return empty;
}

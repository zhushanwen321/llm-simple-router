const MODEL_MAX_LEN = 128;
const MODEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;

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

/**
 * 统一的 DeepSeek thinking 一致性处理。
 *
 * 解决的问题：DeepSeek thinking 模式激活后，要求历史 assistant 消息携带 thinking 信息。
 * 跨模型切换（如 GLM → DeepSeek）或 DeepSeek 自身某些轮次未返回 thinking 时，
 * 历史中会出现"有 tool_calls 但无 thinking"的 assistant 消息。
 *
 * 策略（借鉴 pi coding-agent）：补空值，不降级消息。
 * - OpenAI 格式：补 reasoning_content = ""
 * - Anthropic 格式：补 thinking block（含 signature）
 *
 * 参考：pi-mono/packages/ai/src/providers/openai-completions.ts
 *   requiresReasoningContentOnAssistantMessages 配置
 */

/**
 * 注入 thinking 参数。
 * DeepSeek 开启 thinking 后，后续请求必须显式传 thinking 参数。
 * 客户端可能在后续轮次省略此参数，检测历史自动补上。
 */
function injectThinkingParam(
  body: Record<string, unknown>,
  apiType: "openai" | "openai-responses" | "anthropic",
): void {
  if (body.thinking) return;

  const messages = body.messages as Array<Record<string, unknown>> | undefined;
  if (!messages) return;

  const hasThinking = messages.some(msg => {
    if (msg.role !== "assistant") return false;
    if (apiType === "openai") {
      return msg.reasoning_content !== undefined;
    }
    return Array.isArray(msg.content) &&
      (msg.content as Array<Record<string, unknown>>)
        .some(b => b?.type === "thinking");
  });

  if (!hasThinking) return;

  if (apiType === "openai") {
    body.thinking = { type: "enabled" };
  } else {
    body.thinking = { type: "enabled", budget_tokens: 10000 };
  }
}

/**
 * DeepSeek Anthropic 端点不支持 cache_control，剥离以避免报错。
 */
function stripCacheControl(body: Record<string, unknown>): void {
  if (Array.isArray(body.system)) {
    for (const block of body.system as Array<Record<string, unknown>>) {
      delete block.cache_control;
    }
  }
  const messages = body.messages as Array<Record<string, unknown>> | undefined;
  if (!messages) return;
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content as Array<Record<string, unknown>>) {
        delete block.cache_control;
      }
    }
  }
  if (Array.isArray(body.tools)) {
    for (const tool of body.tools as Array<Record<string, unknown>>) {
      delete tool.cache_control;
    }
  }
}

/**
 * Anthropic 格式：补空 thinking block。
 * DeepSeek thinking 模式下含 tool_use 的 assistant 消息必须携带 thinking 块。
 */
function patchMissingThinkingBlocks(body: Record<string, unknown>): void {
  if (!body.messages) return;

  const messages = body.messages as Array<{ role: string; content: unknown }>;
  const thinkingActive = !!body.thinking || messages.some(
    (msg) => msg.role === "assistant" && Array.isArray(msg.content)
      && (msg.content as Array<Record<string, unknown>>).some(
        (b) => b && typeof b === "object" && b.type === "thinking",
      ),
  );
  if (!thinkingActive) return;

  const needsSignature = detectSignatureUsage(messages);

  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    const blocks = msg.content as Array<Record<string, unknown>>;

    const thinkingIdx = blocks.findIndex(
      (b) => b && typeof b === "object" && b.type === "thinking",
    );

    if (thinkingIdx === -1) {
      const emptyThinking: Record<string, unknown> = { type: "thinking", thinking: "" };
      if (needsSignature) emptyThinking.signature = "";
      blocks.unshift(emptyThinking);
    } else if (thinkingIdx > 0) {
      const [thinkingBlock] = blocks.splice(thinkingIdx, 1);
      blocks.unshift(thinkingBlock);
    }
  }
}

function detectSignatureUsage(
  messages: Array<{ role: string; content: unknown }>,
): boolean {
  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const b of (msg.content as Array<Record<string, unknown>>)) {
      if (b && typeof b === "object" && b.type === "thinking") {
        return "signature" in b;
      }
    }
  }
  return true;
}

/**
 * OpenAI 格式：给缺 reasoning_content 的 assistant 消息补空字符串。
 *
 * 借鉴 pi coding-agent 的 requiresReasoningContentOnAssistantMessages 策略：
 * 不判断"谁生成的"，不降级 tool_calls，只补空值。
 * 补空字符串足以通过 DeepSeek 校验，且不会导致模型忽略 tool_calls（
 * 那是 Anthropic 端点补空 thinking block 的问题，OpenAI 端点无此副作用）。
 */
function patchMissingReasoningContent(body: Record<string, unknown>): void {
  if (!body.thinking && !body.reasoning) return;
  const messages = body.messages as Array<Record<string, unknown>> | undefined;
  if (!messages) return;
  for (const msg of messages) {
    if (msg.role === "assistant"
      && msg.tool_calls
      && (msg.tool_calls as unknown[]).length > 0
      && msg.reasoning_content === undefined
    ) {
      msg.reasoning_content = "";
    }
  }
}

/**
 * 统一的 thinking 一致性入口。
 */
export function patchThinkingConsistency(
  body: Record<string, unknown>,
  apiType: "openai" | "openai-responses" | "anthropic",
): void {
  injectThinkingParam(body, apiType);

  if (apiType === "anthropic") {
    stripCacheControl(body);
    patchMissingThinkingBlocks(body);
  } else {
    patchMissingReasoningContent(body);
  }
}

// 导出内部函数供测试使用
export const _internals = {
  injectThinkingParam,
  patchMissingThinkingBlocks,
  patchMissingReasoningContent,
};

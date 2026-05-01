/**
 * 工具调用轮数限制器。
 *
 * 检测 messages 中连续的 "assistant(tool_use) → user(tool_result)" 轮次数量，
 * 超过阈值时注入提示词提醒 AI 不要陷入无限循环。
 *
 * 与 loop-prevention/tool-loop-guard 不同：
 * - tool-loop-guard 关注"同一工具重复调用"（N-gram 检测 input 重复）
 * - 本模块关注"工具调用轮数过多"（不管是否同一工具，反映 AI 反复操作却无法完成）
 */

/** Anthropic 格式的 content block */
interface AnthropicContentBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: unknown;
  text?: string;
}

/** OpenAI 格式的 tool_call */
interface OpenAIToolCall {
  type?: string;
  function?: { name?: string };
}

interface Message {
  role?: string;
  content?: unknown;
  tool_calls?: OpenAIToolCall[];
}

const DEFAULT_MAX_ROUNDS = 5;
const LOOP_WARNING_PROMPT = "[系统提醒] 你已经连续进行了多轮工具调用但似乎还没有完成任务。请注意不要陷入无限循环，停下来总结当前进展，如果无法继续请直接告知用户。";

/**
 * 统计 messages 中连续的"工具调用轮数"。
 *
 * 一轮定义：assistant 消息包含 tool_use → 后面紧接 user 消息包含 tool_result。
 * 从最后一条消息向前扫描，遇到非工具轮即停止。
 */
export function countConsecutiveToolRounds(messages: Message[]): number {
  let rounds = 0;
  let i = messages.length - 1;

  while (i >= 1) {
    const msg = messages[i];
    // 期望：user 消息包含 tool_result（Anthropic）或 role=tool（OpenAI）
    if (msg.role === "user" || msg.role === "tool") {
      const hasToolResult = hasToolResultContent(msg);
      if (hasToolResult || msg.role === "tool") {
        // 向前找对应的 assistant 消息
        let j = i - 1;
        while (j >= 0 && messages[j].role !== "assistant") j--;
        if (j >= 0 && hasToolUseContent(messages[j])) {
          rounds++;
          i = j - 1;
          continue;
        }
      }
    }
    // assistant 消息本身可能包含 tool_use（最后一轮可能还没 tool_result）
    if (msg.role === "assistant" && hasToolUseContent(msg)) {
      rounds++;
      i--;
      continue;
    }
    break;
  }

  return rounds;
}

/**
 * 检测并注入提示词。返回可能修改后的 body（浅拷贝），未超阈值时原样返回。
 */
export function applyToolRoundLimit(
  body: Record<string, unknown>,
  apiType: "openai" | "anthropic",
  maxRounds: number = DEFAULT_MAX_ROUNDS,
): { body: Record<string, unknown>; injected: boolean; rounds: number } {
  const messages = (body.messages as Message[]) ?? [];
  if (messages.length === 0) return { body, injected: false, rounds: 0 };

  const rounds = countConsecutiveToolRounds(messages);
  if (rounds <= maxRounds) return { body, injected: false, rounds };

  const cloned: Record<string, unknown> = { ...body, messages: [...messages] };
  const clonedMessages = cloned.messages as Message[];

  // 在尾部注入：修改最后一条消息的 content，不插入新消息到头部
  // 这样不会使 LLM 的 KV cache 失效（前面的 messages 保持不变）
  if (apiType === "anthropic") {
    // Anthropic：将提示词作为 text block 追加到最后一条消息的 content 末尾
    const lastMsg = clonedMessages[clonedMessages.length - 1];
    if (lastMsg && Array.isArray(lastMsg.content)) {
      const patched = [...(lastMsg.content as AnthropicContentBlock[])];
      patched.push({ type: "text", text: LOOP_WARNING_PROMPT });
      lastMsg.content = patched;
    } else if (lastMsg && typeof lastMsg.content === "string") {
      lastMsg.content = [
        { type: "text", text: lastMsg.content },
        { type: "text", text: LOOP_WARNING_PROMPT },
      ];
    } else {
      // fallback：追加 user 消息
      clonedMessages.push({ role: "user", content: [{ type: "text", text: LOOP_WARNING_PROMPT }] });
    }
  } else {
    // OpenAI 格式：将提示词追加到最后一条消息的 content 末尾
    const lastMsg = clonedMessages[clonedMessages.length - 1];
    if (lastMsg && typeof lastMsg.content === "string") {
      lastMsg.content = lastMsg.content + "\n\n" + LOOP_WARNING_PROMPT;
    } else if (lastMsg && lastMsg.content != null) {
      lastMsg.content = JSON.stringify(lastMsg.content) + "\n\n" + LOOP_WARNING_PROMPT;
    } else {
      // fallback：追加 user 消息
      clonedMessages.push({ role: "user", content: LOOP_WARNING_PROMPT });
    }
  }

  return { body: cloned, injected: true, rounds };
}

// --- helpers ---

/** Anthropic 格式：检查 content 数组中是否包含 tool_use */
function hasToolUseContent(msg: Message): boolean {
  if (Array.isArray(msg.content)) {
    return (msg.content as AnthropicContentBlock[]).some(
      (block) => block.type === "tool_use",
    );
  }
  // OpenAI 格式
  if (msg.tool_calls && msg.tool_calls.length > 0) return true;
  return false;
}

/** Anthropic 格式：检查 content 数组中是否包含 tool_result */
function hasToolResultContent(msg: Message): boolean {
  if (Array.isArray(msg.content)) {
    return (msg.content as AnthropicContentBlock[]).some(
      (block) => block.type === "tool_result",
    );
  }
  return false;
}

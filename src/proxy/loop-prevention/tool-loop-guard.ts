// src/proxy/loop-prevention/tool-loop-guard.ts

import type { ToolCallRecord, ToolLoopGuardConfig, LoopCheckResult } from "./types.js";
import { SessionTracker } from "./session-tracker.js";
import { NGramLoopDetector } from "./detectors/ngram-detector.js";

export class ToolLoopGuard {
  constructor(
    private readonly tracker: SessionTracker,
    private readonly config: ToolLoopGuardConfig,
  ) {}

  /**
   * 检查本次工具调用是否构成循环。
   * 如果 sessionKey 不可用（无 sessionId），返回 detected: false。
   */
  check(sessionKey: string | null, toolCall: ToolCallRecord | null): LoopCheckResult {
    if (!sessionKey || !toolCall) return { detected: false };
    if (!this.config.enabled) return { detected: false };

    const history = this.tracker.recordAndGetHistory(sessionKey, toolCall);

    // 第一层：筛选同名的 tool_name 记录
    // 未达阈值时不重置 loopCount，保留跨请求升级到层级 2/3 的可能性
    const sameNameRecords = history.filter(r => r.toolName === toolCall.toolName);
    if (sameNameRecords.length < this.config.minConsecutiveCount) {
      return { detected: false };
    }

    // 第二层：N-gram 检测 input 参数文本
    const detector = new NGramLoopDetector(this.config.detectorConfig);
    for (const record of sameNameRecords) {
      detector.feed(record.inputText);
    }

    if (detector.getStatus().detected) {
      this.tracker.incrementLoopCount(sessionKey);
      return { detected: true, reason: "tool_call_loop", history: sameNameRecords };
    }

    this.tracker.resetLoopCount(sessionKey);
    return { detected: false };
  }

  injectLoopBreakPrompt(body: Record<string, unknown>, apiType: "openai" | "openai-responses" | "anthropic", toolName: string): Record<string, unknown> {
    const cloned = JSON.parse(JSON.stringify(body));
    const prompt = `[系统提醒] 检测到你可能陷入了反复调用 "${toolName}" 工具的循环。请停下来，总结当前进展，直接告知用户。`;

    if (apiType === "anthropic") {
      const system = cloned.system;
      if (Array.isArray(system)) {
        system.push({ type: "text", text: prompt });
      } else if (typeof system === "string") {
        cloned.system = [{ type: "text", text: system }, { type: "text", text: prompt }];
      } else {
        cloned.system = [{ type: "text", text: prompt }];
      }
    } else if (apiType === "openai-responses") {
      // Append a user message to input items
      const inputArr = Array.isArray(body.input) ? [...(body.input as Array<Record<string, unknown>>)] : [];
      inputArr.push({
        type: "message" as const,
        role: "user" as const,
        content: [{ type: "input_text", text: `[系统提醒] 检测到工具 "${toolName}" 可能陷入循环。请停止重复调用，总结当前进展。` }],
      });
      return { ...body, input: inputArr };
    } else {
      const messages = (cloned.messages as unknown[]) ?? [];
      messages.unshift({ role: "system", content: prompt });
      cloned.messages = messages;
    }
    return cloned;
  }
}

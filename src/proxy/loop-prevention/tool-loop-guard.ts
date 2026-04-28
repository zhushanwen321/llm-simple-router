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

  injectLoopBreakPrompt(body: Record<string, unknown>, apiType: "openai" | "anthropic", toolName: string): void {
    const prompt = `你正在重复调用同一个工具 "${toolName}"。` +
      `这很可能陷入了一个循环。请仔细回顾对话历史，` +
      `分析之前调用该工具的结果，停止重复调用，` +
      `改用其他方式完成任务或直接告知用户你遇到的问题。`;

    if (apiType === "anthropic") {
      const system = body.system;
      if (Array.isArray(system)) {
        (system as Array<Record<string, unknown>>).push({ type: "text", text: prompt });
      } else if (typeof system === "string") {
        body.system = [{ type: "text", text: system }, { type: "text", text: prompt }];
      } else {
        body.system = [{ type: "text", text: prompt }];
      }
    } else {
      // OpenAI: 在 messages 开头插入 system message
      const messages = body.messages as Array<Record<string, unknown>> | undefined;
      if (messages) {
        messages.unshift({ role: "system", content: prompt });
      }
    }
  }
}

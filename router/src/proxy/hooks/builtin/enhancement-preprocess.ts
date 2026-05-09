/**
 * pre_route hook: 工具轮数限制 + 工具循环检测。
 *
 * 在路由解析之前执行：
 * 1. 加载 enhancementConfig（从 DB settings）
 * 2. applyToolRoundLimit — 超过阈值时注入警告提示词，修改 ctx.body
 * 3. ToolLoopGuard — 检测连续重复工具调用，可能抛出 PipelineAbort (422)
 *
 * 依赖：ctx.metadata 中需设置 "db" 和 "container"
 */
import { HTTP_UNPROCESSABLE_ENTITY, HTTP_CLIENT_CLOSED } from "../../../core/constants.js";
import { SERVICE_KEYS, type ServiceContainer } from "../../../core/container.js";
import { ToolLoopGuard, type SessionTracker } from "@llm-router/core/loop-prevention";
import Database from "better-sqlite3";
import type { PipelineHook, PipelineContext } from "../../pipeline/types.js";
import { PipelineAbort } from "../../pipeline/types.js";
import { loadEnhancementConfig } from "../../routing/enhancement-config.js";
import { applyToolRoundLimit } from "../../patch/tool-round-limiter.js";
import { extractLastToolUse } from "../../handler/proxy-handler-utils.js";

const TIER2_LOOP_THRESHOLD = 2;

export const enhancementPreprocessHook: PipelineHook = {
  name: "builtin:enhancement-preprocess",
  phase: "pre_route",
  priority: 110,
  execute(ctx: PipelineContext): void {
    const { request, body, sessionId, metadata } = ctx;
    const db = metadata.get("db") as Database.Database;
    const container = metadata.get("container") as ServiceContainer;
    if (!db || !container) return;

    const enhancementConfig = loadEnhancementConfig(db);
    const apiType = ctx.apiType as "openai" | "openai-responses" | "anthropic";

    // --- 工具轮数限制 ---
    if (enhancementConfig.tool_round_limit_enabled) {
      const roundResult = applyToolRoundLimit(body, apiType);
      if (roundResult.injected) {
        ctx.body = roundResult.body;
        ctx.snapshot.add({ stage: "tool_round_limit", action: "inject_warning", rounds: roundResult.rounds });
        request.log.info({ sessionId, rounds: roundResult.rounds }, "Tool round limit reached, injecting warning prompt");
      }
    }

    // --- 工具循环检测 ---
    if (!enhancementConfig.tool_call_loop_enabled || !sessionId) return;

    const sessionTracker = container.resolve<SessionTracker>(SERVICE_KEYS.sessionTracker);
    if (!sessionTracker) return;

    const routerKeyId = (request.routerKey as { id?: string } | undefined)?.id ?? null;
    const sessionKey = routerKeyId ? `${routerKeyId}:${sessionId}` : sessionId;
    const lastToolUse = extractLastToolUse(body);
    if (!lastToolUse) return;

    const toolGuard = new ToolLoopGuard(sessionTracker, {
      enabled: true,
      minConsecutiveCount: 3,
      detectorConfig: { n: 6, windowSize: 500, repeatThreshold: 5 },
    });
    const checkResult = toolGuard.check(sessionKey, lastToolUse);
    if (!checkResult.detected) return;

    const loopCount = sessionTracker.getLoopCount(sessionKey);
    if (loopCount === 1) {
      // 层级 1：透明重试 — 注入中断提示词
      ctx.body = toolGuard.injectLoopBreakPrompt(body, apiType, lastToolUse.toolName);
      ctx.snapshot.add({ stage: "tool_guard", action: "inject_break_prompt", tool: lastToolUse.toolName });
      request.log.warn({ sessionId, toolName: lastToolUse.toolName, loopCount },
        "Tool call loop detected, injecting break prompt");
    } else if (loopCount === TIER2_LOOP_THRESHOLD) {
      // 层级 2：优雅中断
      ctx.snapshot.add({ stage: "tool_guard", action: "abort_422", tool: lastToolUse.toolName });
      throw new PipelineAbort(HTTP_UNPROCESSABLE_ENTITY, {
        error: {
          type: "tool_call_loop_detected",
          message: `检测到工具调用循环（连续重复调用 "${lastToolUse.toolName}"）。请求已中断。`,
          suggestion: "请回顾对话历史，停止重复调用工具，直接告知用户当前的进展和遇到的问题。",
        },
      });
    } else {
      // 层级 3：直接断开
      ctx.snapshot.add({ stage: "tool_guard", action: "hard_disconnect", tool: lastToolUse.toolName });
      request.log.warn({ sessionId, toolName: lastToolUse.toolName, loopCount },
        "Tool call loop detected, hard disconnecting");
      throw new PipelineAbort(HTTP_CLIENT_CLOSED, { _disconnect: true });
    }
  },
};

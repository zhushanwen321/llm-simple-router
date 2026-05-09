/**
 * pre_route hook: 客户端类型检测 + session_id 提取。
 *
 * 在路由解析前执行（priority 200），检测客户端类型并提取 session_id，
 * 写入 ctx.metadata 供后续 hook（cache-estimation、request-logging）使用。
 *
 * 依赖：detectClientAgentType() 从 proxy-handler-utils 分析请求头。
 */
import { detectClientAgentType } from "../../handler/proxy-handler-utils.js";
import type { PipelineHook, PipelineContext } from "../../pipeline/types.js";

export const clientDetectionHook: PipelineHook = {
  name: "builtin:client-detection",
  phase: "pre_route",
  priority: 200,
  execute(ctx: PipelineContext): void {
    const headers = ctx.request.headers as Record<string, string>;

    // 1. 客户端类型检测
    const clientType = detectClientAgentType(headers);
    ctx.metadata.set("client_type", clientType);

    // 2. session_id 提取（claude-code 优先，fallback pi）
    const ccSessionId = headers["x-claude-code-session-id"];
    const piSessionId = headers["x-pi-session-id"];
    const sessionId =
      (typeof ccSessionId === "string" ? ccSessionId : undefined) ??
      (typeof piSessionId === "string" ? piSessionId : undefined);
    if (sessionId) {
      ctx.metadata.set("session_id", sessionId);
    }
  },
};

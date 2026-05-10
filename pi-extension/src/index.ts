import type { ExtensionAPI, BeforeProviderRequestEvent } from "@mariozechner/pi-coding-agent";

/**
 * Pi extension for llm-simple-router: 注入 session_id 到 provider 请求。
 *
 * 通过 before_provider_request 事件，将 pi 的 session ID 注入到请求 payload 中。
 * Router 端的 client-detection hook 从 HTTP header x-pi-session-id 识别客户端，
 * 但 pi extension API 不支持直接修改 HTTP headers，因此这里将 session_id
 * 写入 payload 顶层字段，供 router 或中间层提取。
 *
 * 当 pi 未来支持 HTTP header 注入时，可迁移为直接设置 x-pi-session-id header。
 */
export default function (pi: ExtensionAPI) {
  pi.on("before_provider_request", (event: BeforeProviderRequestEvent, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    if (!sessionId) return;

    // payload 是 unknown，尝试注入 session_id 字段
    if (event.payload && typeof event.payload === "object") {
      (event.payload as Record<string, unknown>)["x-pi-session-id"] = sessionId;
    }
  });
}

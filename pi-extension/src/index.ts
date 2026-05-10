import type { ExtensionAPI, BeforeProviderRequestEvent } from "@mariozechner/pi-coding-agent";

/**
 * Pi extension for llm-simple-router: 注入 session_id 到 provider 请求。
 *
 * Pi extension API 的 before_provider_request 不支持直接修改 HTTP headers，
 * 因此将 session_id 写入请求 payload 顶层字段（key 为配置的 session_header_key）。
 * Router 端的 client-detection hook 会同时从 HTTP header 和 payload body 中查找。
 *
 * 当 pi 未来支持 HTTP header 注入时，可迁移为直接设置 header。
 */
export default function (pi: ExtensionAPI) {
  pi.on("before_provider_request", (event: BeforeProviderRequestEvent, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    if (!sessionId) return;

    // 写入 payload 顶层字段，router 的 detectClient() 会从 body 中 fallback 查找
    if (event.payload && typeof event.payload === "object") {
      (event.payload as Record<string, unknown>)["x-pi-session-id"] = sessionId;
    }
  });
}

/**
 * pre_route hook: 客户端类型检测 + session_id 提取。
 *
 * 在路由解析前执行（priority 200），从 DB 加载 session header 配置，
 * 遍历配置列表匹配请求头，识别客户端类型并提取 session_id，
 * 写入 ctx.metadata 供后续 hook（cache-estimation、request-logging）使用。
 *
 * 兼容：当无 DB 配置时回退到默认配置 + user-agent 检测。
 */
import { detectClient, type ClientSessionHeaderEntry } from "../../handler/proxy-handler-utils.js";
import { getClientSessionHeaders } from "../../../db/settings.js";
import type { PipelineHook, PipelineContext } from "../../pipeline/types.js";
import type Database from "better-sqlite3";

const DEFAULT_CLIENT_SESSION_HEADERS: ClientSessionHeaderEntry[] = [
  { client_type: "claude-code", session_header_key: "x-claude-code-session-id" },
  { client_type: "pi", session_header_key: "x-pi-session-id" },
];

export const clientDetectionHook: PipelineHook = {
  name: "builtin:client-detection",
  phase: "pre_route",
  priority: 200,
  execute(ctx: PipelineContext): void {
    const headers = ctx.request.headers as Record<string, string>;
    const db = ctx.metadata.get("db") as Database.Database | undefined;

    // 从 DB 加载配置，无 DB 时使用默认配置
    const config = db ? getClientSessionHeaders(db) : DEFAULT_CLIENT_SESSION_HEADERS;

    // 配置驱动的客户端识别
    const result = detectClient(headers, config);

    // 兼容：配置未匹配时，回退到 user-agent 检测
    if (result.client_type === "unknown") {
      const ua = (headers["user-agent"] ?? "").toLowerCase();
      if (ua.includes("pi-coding-agent")) {
        ctx.metadata.set("client_type", "pi");
        // pi 可能没有 session header，但 x-pi-session-id 可能存在
        const piSessionId = headers["x-pi-session-id"];
        if (piSessionId && typeof piSessionId === "string") {
          ctx.metadata.set("session_id", piSessionId);
        }
        return;
      }
    }

    ctx.metadata.set("client_type", result.client_type);
    if (result.session_id) {
      ctx.metadata.set("session_id", result.session_id);
    }
  },
};

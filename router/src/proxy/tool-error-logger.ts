import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import type { FailedToolResult } from "./handler/proxy-handler-utils.js";

export interface ToolErrorLogContext {
  db: Database.Database;
  providerId: string;
  backendModel: string;
  clientAgentType: string;
  requestLogId: string;
  routerKeyId: string | null;
  sessionId: string | undefined;
}

/**
 * 将失败的 tool_result 批量写入 tool_error_logs 表。
 * 每条失败记录独立一行。只存索引字段，
 * 完整 tool_input / error_content 通过
 * request_log_id + tool_use_id 从 request_logs 回溯。
 */
export function logToolErrors(failures: FailedToolResult[], ctx: ToolErrorLogContext): void {
  if (failures.length === 0) return;

  const stmt = ctx.db.prepare(`
    INSERT INTO tool_error_logs
      (id, request_log_id, tool_use_id, provider_id, backend_model,
       client_agent_type, tool_name, router_key_id, session_id, created_at)
    VALUES
      (@id, @request_log_id, @tool_use_id, @provider_id, @backend_model,
       @client_agent_type, @tool_name, @router_key_id, @session_id, @created_at)
  `);

  const now = new Date().toISOString();
  const insertMany = ctx.db.transaction(() => {
    for (const f of failures) {
      stmt.run({
        id: randomUUID(),
        request_log_id: ctx.requestLogId,
        tool_use_id: f.toolUseId ?? "unknown",
        provider_id: ctx.providerId,
        backend_model: ctx.backendModel,
        client_agent_type: ctx.clientAgentType,
        tool_name: f.toolName,
        router_key_id: ctx.routerKeyId,
        session_id: ctx.sessionId ?? null,
        created_at: now,
      });
    }
  });
  insertMany();
}

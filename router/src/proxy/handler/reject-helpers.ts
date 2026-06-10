/**
 * Failover-loop 辅助 — reject / plugin 调整工具。
 *
 * 从 failover-loop.ts 提取：
 * - RejectParams（拒绝日志参数）
 * - applyPluginAdjustments（Plugin 请求前/后调整）
 * - rejectAndReply（写入拒绝日志 + 发送错误响应）
 */
import type { FastifyReply } from "fastify";
import type Database from "better-sqlite3";
import type { RetryRuleMatcher } from "../orchestration/retry-rules.js";
import type { PluginRegistry } from "../transform/plugin-registry.js";
import type { RequestTransformContext } from "../transform/plugin-types.js";
import type { ApiType } from "../transform/types.js";
import type { LogFileWriter } from "../../storage/log-file-writer.js";
import type { RawHeaders } from "../types.js";
import { insertRejectedLog } from "../log-helpers.js";

// ---------- Rejected log helper ----------

export interface RejectParams {
  db: Database.Database;
  logId: string;
  apiType: string;
  model: string;
  startTime: number;
  isStream: boolean;
  routerKeyId: string | null;
  originalBody: Record<string, unknown>;
  clientHeaders: RawHeaders;
  isFailover: boolean;
  originalRequestId: string | null;
  sessionId: string | undefined;
  pipelineSnapshot?: string;
  matcher?: RetryRuleMatcher;
  logFileWriter?: LogFileWriter | null;
  mappingReason?: string | null;
}

// --- Plugin 调整 body 和 headers ---
export function applyPluginAdjustments(
  pluginRegistry: PluginRegistry | undefined,
  body: Record<string, unknown>,
  clientApiType: string,
  provider: { id: string; name: string; base_url: string; api_type: string },
): { headers: Record<string, string> } {
  if (!pluginRegistry) return { headers: {} };
  const pluginCtx: RequestTransformContext = {
    body,
    headers: {},
    sourceApiType: clientApiType as ApiType,
    targetApiType: provider.api_type as ApiType,
    provider: { id: provider.id, name: provider.name, base_url: provider.base_url, api_type: provider.api_type },
  };
  pluginRegistry.applyBeforeRequest(pluginCtx);
  pluginRegistry.applyAfterRequest(pluginCtx);
  return { headers: pluginCtx.headers };
}

// --- 拒绝请求并回复客户端 ---
export function rejectAndReply(
  reply: FastifyReply,
  params: RejectParams,
  error: { statusCode: number; body: unknown },
  errorMessage: string,
  providerId?: string,
  afterLog?: () => void,
): FastifyReply {
  insertRejectedLog({
    db: params.db, logId: params.logId, apiType: params.apiType as "openai" | "openai-responses" | "anthropic", model: params.model,
    statusCode: error.statusCode, errorMessage, startTime: params.startTime,
    isStream: params.isStream, routerKeyId: params.routerKeyId,
    originalBody: params.originalBody, clientHeaders: params.clientHeaders,
    providerId: providerId ?? null, originalModel: null,
    isFailover: params.isFailover, originalRequestId: params.originalRequestId,
    sessionId: params.sessionId, pipelineSnapshot: params.pipelineSnapshot,
    matcher: params.matcher, logFileWriter: params.logFileWriter,
    mapping_reason: params.mappingReason ?? null,
  });
  try { afterLog?.(); } catch (e: unknown) { /* tool error log 写入失败不影响响应 */ console.warn("afterLog callback failed:", (e as Error).message); }
  return reply.code(error.statusCode).send(error.body);
}

import type { FastifyRequest } from "fastify";
import Database from "better-sqlite3";
import { getSetting } from "../db/settings.js";
import { resolveMapping } from "./mapping-resolver.js";
import { parseDirective } from "./directive-parser.js";
import { modelState } from "./model-state.js";
import { cleanRouterResponses } from "./response-cleaner.js";

export interface EnhancementResult {
  effectiveModel: string;
  originalModel: string | null;
}

const MODEL_INFO_TAG_TYPE = "model-info";

/**
 * 在代理转发前应用代理增强逻辑（指令解析 + 会话记忆 + 模型替换）。
 * 仅当 proxy_enhancement.claude_code_enabled 开启时生效。
 */
export function applyEnhancement(
  db: Database.Database,
  request: FastifyRequest,
  clientModel: string,
): EnhancementResult {
  const enhancementRaw = getSetting(db, "proxy_enhancement");
  let enhancement: { claude_code_enabled?: boolean } | null = null;
  try {
    enhancement = enhancementRaw ? JSON.parse(enhancementRaw) : null;
  } catch {
    request.log.warn("Invalid proxy_enhancement JSON, feature disabled");
  }

  if (enhancement?.claude_code_enabled !== true) {
    return { effectiveModel: clientModel, originalModel: null };
  }

  // 清理历史消息中的 <router-response> 标签
  const cleaned = cleanRouterResponses(request.body as Record<string, unknown>);
  (request.body as Record<string, unknown>).messages = cleaned.messages;

  const directive = parseDirective(request.body as Record<string, unknown>);

  if (directive.modelName) {
    // 内联模型指令 → resolveMapping 验证
    const resolvedDirective = resolveMapping(db, directive.modelName, { now: new Date() });
    if (resolvedDirective) {
      modelState.set(request.routerKey?.id ?? null, directive.modelName);
      (request.body as Record<string, unknown>).messages = directive.cleanedBody.messages;
      return { effectiveModel: directive.modelName, originalModel: clientModel };
    }
    // 映射失败时保留原始请求（降级策略）
    return { effectiveModel: clientModel, originalModel: null };
  }

  // 无指令 → 查询会话记忆
  const remembered = modelState.get(request.routerKey?.id ?? null);
  if (remembered) {
    const resolvedRemembered = resolveMapping(db, remembered, { now: new Date() });
    if (resolvedRemembered) {
      return { effectiveModel: remembered, originalModel: clientModel };
    }
  }

  return { effectiveModel: clientModel, originalModel: null };
}

/** 生成注入到非流式响应中的模型信息标签 */
export function buildModelInfoTag(effectiveModel: string): string {
  return `<router-response type="${MODEL_INFO_TAG_TYPE}">当前模型: ${effectiveModel}</router-response>`;
}

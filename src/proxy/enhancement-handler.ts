import { randomUUID } from "crypto";
import type { FastifyRequest } from "fastify";
import Database from "better-sqlite3";
import { getSetting } from "../db/settings.js";
import { getAllMappingGroups, getAllModelMappings } from "../db/index.js";
import { resolveMapping } from "./mapping-resolver.js";
import { parseDirective } from "./directive-parser.js";
import { modelState } from "./model-state.js";
import { cleanRouterResponses } from "./response-cleaner.js";

export interface InterceptResponse {
  statusCode: number;
  body: unknown;
  /** 拦截元数据，用于日志记录 */
  meta?: { action: string; detail?: string };
}

export interface EnhancementResult {
  effectiveModel: string;
  originalModel: string | null;
  interceptResponse: InterceptResponse | null;
}

const MODEL_INFO_TAG_TYPE = "model-info";

/**
 * 在代理转发前应用代理增强逻辑（指令解析 + 会话记忆 + 模型替换 + 命令拦截）。
 * 仅当 proxy_enhancement.claude_code_enabled 开启时生效。
 */
export function applyEnhancement(
  db: Database.Database,
  request: FastifyRequest,
  clientModel: string,
  sessionId?: string,
): EnhancementResult {
  const nullResult: EnhancementResult = { effectiveModel: clientModel, originalModel: null, interceptResponse: null };

  const enhancementRaw = getSetting(db, "proxy_enhancement");
  let enhancement: { claude_code_enabled?: boolean } | null = null;
  try {
    enhancement = enhancementRaw ? JSON.parse(enhancementRaw) : null;
  } catch {
    request.log.warn("Invalid proxy_enhancement JSON, feature disabled");
  }

  if (enhancement?.claude_code_enabled !== true) {
    return nullResult;
  }

  // 清理历史消息中的 <router-response> 标签
  const cleaned = cleanRouterResponses(request.body as Record<string, unknown>);
  (request.body as Record<string, unknown>).messages = cleaned.messages;

  const directive = parseDirective(request.body as Record<string, unknown>);

  // 命令拦截：select-model → 返回可用模型列表
  if (directive.isCommandMessage && directive.command?.startsWith("select-model")) {
    const routerKeyId = request.routerKey?.id ?? null;
    const parts = directive.command.trim().split(/\s+/);
    const arg = parts.length > 1 ? parts.slice(1).join(" ") : null;

    // 带参数：设置模型并返回确认
    if (arg && arg !== "") {
      const resolved = resolveMapping(db, arg, { now: new Date() });
      if (resolved) {
        modelState.set(routerKeyId, arg, sessionId, clientModel, "command");
      }
      return {
        effectiveModel: clientModel,
        originalModel: null,
        interceptResponse: {
          ...buildSelectModelResponse(db, routerKeyId, request.routerKey?.allowed_models, resolved ? arg : undefined),
          meta: { action: resolved ? "模型选择" : "模型选择失败", detail: arg },
        },
      };
    }

    // 无参数：返回模型列表
    return {
      effectiveModel: clientModel,
      originalModel: null,
      interceptResponse: {
        ...buildSelectModelResponse(db, routerKeyId, request.routerKey?.allowed_models),
        meta: { action: "模型列表" },
      },
    };
  }

  if (directive.modelName) {
    // 内联模型指令 → resolveMapping 验证
    const resolvedDirective = resolveMapping(db, directive.modelName, { now: new Date() });
    if (resolvedDirective) {
      modelState.set(request.routerKey?.id ?? null, directive.modelName, sessionId, clientModel, "directive");
      (request.body as Record<string, unknown>).messages = directive.cleanedBody.messages;
      return { effectiveModel: directive.modelName, originalModel: clientModel, interceptResponse: null };
    }
    // 映射失败时保留原始请求（降级策略）
    return nullResult;
  }

  // 无指令 → 查询会话记忆
  const remembered = modelState.get(request.routerKey?.id ?? null, sessionId);
  if (remembered) {
    const resolvedRemembered = resolveMapping(db, remembered, { now: new Date() });
    if (resolvedRemembered) {
      return { effectiveModel: remembered, originalModel: clientModel, interceptResponse: null };
    }
  }

  return nullResult;
}

/** 查询所有可用的 client_model 并构造 Anthropic 格式响应 */
function buildSelectModelResponse(
  db: Database.Database,
  _routerKeyId: string | null,
  allowedModelsRaw?: string | null,
  selectedModel?: string | null,
): InterceptResponse {
  // mapping_groups 是路由的核心数据源，model_mappings 是可选的辅助映射
  const groups = getAllMappingGroups(db);
  const allMappings = getAllModelMappings(db);
  const activeMappingModels = new Set(
    allMappings.filter(m => m.is_active).map(m => m.client_model),
  );
  // 合并去重：有分组的（可路由）+ 活跃的辅助映射
  const models = [...new Set([
    ...groups.map(g => g.client_model),
    ...activeMappingModels,
  ])];

  // 按 allowed_models 过滤
  let allowedSet: Set<string> | null = null;
  if (allowedModelsRaw) {
    try {
      const parsed: string[] = JSON.parse(allowedModelsRaw).filter((s: string) => s.trim() !== "");
      if (parsed.length > 0) allowedSet = new Set(parsed);
    } catch { /* 忽略解析失败 */ }
  }
  const filtered = allowedSet ? models.filter(m => allowedSet!.has(m)) : models;

  // 构造文本
  let text: string;
  if (selectedModel) {
    // 带参数调用：返回选择确认
    text = `已选择模型: ${selectedModel}`;
  } else if (filtered.length > 0) {
    text = filtered.map((m, i) => `${i + 1}. ${m}`).join("\n");
  } else {
    text = "（无可用模型）";
  }

  const body = {
    id: `msg-${randomUUID()}`,
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    model: "router",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };

  return { statusCode: 200, body };
}

/** 生成注入到非流式响应中的模型信息标签 */
export function buildModelInfoTag(effectiveModel: string): string {
  return `<router-response type="${MODEL_INFO_TAG_TYPE}">当前模型: ${effectiveModel}</router-response>`;
}

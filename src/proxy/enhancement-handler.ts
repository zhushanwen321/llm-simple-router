import { randomUUID } from "crypto";
import type { FastifyRequest } from "fastify";
import Database from "better-sqlite3";
import { getSetting } from "../db/settings.js";
import { getActiveProviderModels, resolveByProviderModel } from "../db/index.js";
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
 * 解析 "provider_name/backend_model" 格式，返回对应的 client_model。
 * provider_name 只允许 [a-zA-Z0-9_-]，/ 作为分隔符。
 */
function resolveProviderModel(db: Database.Database, providerSlashModel: string): string | null {
  const match = /^([a-zA-Z0-9_-]+)\/(.+)$/.exec(providerSlashModel);
  if (!match) return null;
  const resolved = resolveByProviderModel(db, match[1], match[2]);
  return resolved?.client_model ?? null;
}

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
      const resolvedClientModel = resolveProviderModel(db, arg);
      if (!resolvedClientModel) {
        return {
          effectiveModel: clientModel,
          originalModel: null,
          interceptResponse: {
            ...buildTextResponse("error", `未找到模型: ${arg}`),
            meta: { action: "模型选择失败", detail: arg },
          },
        };
      }
      modelState.set(routerKeyId, arg, sessionId, clientModel, "command");
      return {
        effectiveModel: arg,
        originalModel: null,
        interceptResponse: {
          ...buildSelectModelResponse(db, request.routerKey?.allowed_models ?? null, arg),
          meta: { action: "模型选择", detail: arg },
        },
      };
    }

    // 无参数：返回模型列表
    return {
      effectiveModel: clientModel,
      originalModel: null,
      interceptResponse: {
        ...buildSelectModelResponse(db, request.routerKey?.allowed_models ?? null),
        meta: { action: "模型列表" },
      },
    };
  }

  if (directive.modelName) {
    // 内联模型指令 → resolveMapping 验证（client_model 格式）
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
    // 优先尝试 provider_name/backend_model 格式（select-model 命令存储）
    // 直接保留该格式，resolveMapping 会解析出 provider + model
    const providerResolved = resolveProviderModel(db, remembered);
    if (providerResolved) {
      return { effectiveModel: remembered, originalModel: clientModel, interceptResponse: null };
    }
    // 回退到 client_model 格式（内联指令存储）
    const resolvedRemembered = resolveMapping(db, remembered, { now: new Date() });
    if (resolvedRemembered) {
      return { effectiveModel: remembered, originalModel: clientModel, interceptResponse: null };
    }
  }

  return nullResult;
}

/** 构造 Anthropic 格式的 router 文本响应 */
function buildTextResponse(type: string, inner: string): Omit<InterceptResponse, "meta"> {
  const text = `<router-response type="${type}">${inner}</router-response>`;
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

/** 查询所有可用的 provider_model 并构造响应 */
function buildSelectModelResponse(
  db: Database.Database,
  allowedModelsRaw: string | null | undefined,
  selectedModel?: string | null,
): Omit<InterceptResponse, "meta"> {
  const providerModels = getActiveProviderModels(db);

  // 按 allowed_models 过滤（allowed_models 存储的是 client_model 列表）
  let allowedSet: Set<string> | null = null;
  if (allowedModelsRaw) {
    try {
      const parsed: string[] = JSON.parse(allowedModelsRaw).filter((s: string) => s.trim() !== "");
      if (parsed.length > 0) allowedSet = new Set(parsed);
    } catch { return buildTextResponse("model-list", "（解析 allowed_models 失败）") }
  }
  const filtered = allowedSet
    ? providerModels.filter(m => allowedSet!.has(m.backend_model))
    : providerModels;

  // 去重并格式化为 "provider_name/backend_model"
  const seen = new Set<string>();
  const displayModels: string[] = [];
  for (const m of filtered) {
    const key = `${m.provider_name}/${m.backend_model}`;
    if (!seen.has(key)) {
      seen.add(key);
      displayModels.push(key);
    }
  }

  let inner: string;
  let responseType: string;
  if (selectedModel) {
    inner = `已选择模型: ${selectedModel}`;
    responseType = "model-selected";
  } else if (displayModels.length > 0) {
    inner = displayModels.map((m, i) => `${i + 1}. ${m}`).join("\n");
    responseType = "model-list";
  } else {
    inner = "（无可用模型）";
    responseType = "model-list";
  }

  return buildTextResponse(responseType, inner);
}

/** 生成注入到非流式响应中的模型信息标签 */
export function buildModelInfoTag(effectiveModel: string): string {
  return `<router-response type="${MODEL_INFO_TAG_TYPE}">当前模型: ${effectiveModel}</router-response>`;
}

import { randomUUID } from "crypto";
import type { FastifyRequest } from "fastify";
import Database from "better-sqlite3";
import { loadEnhancementConfig, type EnhancementConfig } from "../routing/enhancement-config.js";
import { getActiveProviderModels, resolveByProviderModel } from "../../db/index.js";
import { resolveMapping } from "../routing/mapping-resolver.js";
import { parseDirective, parseToolResult, TOOL_USE_ID_PREFIX, TOOL_USE_ID_PROVIDER_PREFIX } from "./directive-parser.js";
import { modelState } from "../routing/model-state.js";
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
const SKIP_LABEL = "不选择";
const TWO_STEP_THRESHOLD = 9;
const MODELS_PER_GROUP = 3;

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

/** 检查请求中是否包含 AskUserQuestion 工具（判断客户端是否为 Claude Code） */
function hasAskUserQuestion(body: Record<string, unknown>): boolean {
  const tools = body.tools as Array<{ name?: string }> | undefined;
  if (!tools) return false;
  return tools.some(t => t.name === "AskUserQuestion");
}

/**
 * 获取去重后的 provider/backend_model 显示列表，按 allowed_models 过滤。
 * 供 buildSelectModelResponse 和 AskUserQuestion 路径复用。
 */
function buildDisplayModels(
  db: Database.Database,
  allowedModelsRaw: string | null | undefined,
): string[] {
  const providerModels = getActiveProviderModels(db);
  let allowedSet: Set<string> | null = null;
  if (allowedModelsRaw) {
    try {
      const parsed: string[] = JSON.parse(allowedModelsRaw).filter((s: string) => s.trim() !== "");
      if (parsed.length > 0) allowedSet = new Set(parsed);
    } catch { /* eslint-disable-line taste/no-silent-catch -- JSON.parse 解析失败时不做过滤，属于预期降级 */ }
  }
  const filtered = allowedSet
    ? providerModels.filter(m => allowedSet!.has(m.backend_model))
    : providerModels;

  const seen = new Set<string>();
  const displayModels: string[] = [];
  for (const m of filtered) {
    const key = `${m.provider_name}/${m.backend_model}`;
    if (!seen.has(key)) { seen.add(key); displayModels.push(key); }
  }
  return displayModels;
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
  enhancementConfig?: EnhancementConfig,
): EnhancementResult {
  const nullResult: EnhancementResult = { effectiveModel: clientModel, originalModel: null, interceptResponse: null };

  const enhancement = enhancementConfig ?? loadEnhancementConfig(db);

  if (!enhancement.claude_code_enabled) {
    return nullResult;
  }

  // 检测 AskUserQuestion 的 tool_result 回调（用户在 UI 上选择了模型或 provider）
  const toolResult = parseToolResult(request.body as Record<string, unknown>);
  if (toolResult.isRouterToolResult) {
    const routerKeyId = request.routerKey?.id ?? null;
    const nonSkipAnswers = toolResult.allAnswers.filter(a => a !== SKIP_LABEL);

    // 所有回答都是"不选择" → 取消
    if (nonSkipAnswers.length === 0) {
      return {
        effectiveModel: clientModel,
        originalModel: null,
        interceptResponse: {
          ...buildTextResponse("model-select-cancelled", "已取消选择"),
          meta: { action: "取消模型选择" },
        },
      };
    }

    // 选择了多个 → 提示错误
    if (nonSkipAnswers.length > 1) {
      return {
        effectiveModel: clientModel,
        originalModel: null,
        interceptResponse: {
          ...buildTextResponse("model-select-error", "选择错误：只能选择一个模型或提供商，请重新输入 /select-model 选择"),
          meta: { action: "选择错误" },
        },
      };
    }

    const answer = nonSkipAnswers[0];

    // 两步式：用户选择了 provider → 返回该 provider 的模型列表
    if (toolResult.isProviderSelection) {
      const allModels = buildDisplayModels(db, request.routerKey?.allowed_models ?? null);
      const providerModels = getModelsForProvider(allModels, answer);
      if (providerModels.length === 0) {
        return {
          effectiveModel: clientModel,
          originalModel: null,
          interceptResponse: {
            ...buildTextResponse("error", `未找到 provider: ${answer}`),
            meta: { action: "模型选择失败", detail: answer },
          },
        };
      }
      const questions = buildModelQuestions(providerModels);
      return {
        effectiveModel: clientModel,
        originalModel: null,
        interceptResponse: {
          ...buildAskUserQuestionPayload(questions, false, providerModels),
          meta: { action: `模型列表(provider=${answer})` },
        },
      };
    }

    // 模型选择（直接或两步式第二步）
    const resolvedClientModel = resolveProviderModel(db, answer);
    if (resolvedClientModel) {
      modelState.set(routerKeyId, answer, sessionId, clientModel, "command");
      return {
        effectiveModel: answer,
        originalModel: null,
        interceptResponse: {
          ...buildTextResponse("model-selected", `已选择模型: ${answer}`),
          meta: { action: "模型选择", detail: answer },
        },
      };
    }
    return {
      effectiveModel: clientModel,
      originalModel: null,
      interceptResponse: {
        ...buildTextResponse("error", `未找到模型: ${answer}`),
        meta: { action: "模型选择失败", detail: answer },
      },
    };
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
    if (hasAskUserQuestion(request.body as Record<string, unknown>)) {
      const displayModels = buildDisplayModels(db, request.routerKey?.allowed_models ?? null);
      if (displayModels.length === 0) {
        return {
          effectiveModel: clientModel,
          originalModel: null,
          interceptResponse: {
            ...buildTextResponse("model-list", "（无可用模型）"),
            meta: { action: "模型列表" },
          },
        };
      }
      // >= TWO_STEP_THRESHOLD 且多个 provider → 两步式：先选 provider
      if (displayModels.length >= TWO_STEP_THRESHOLD) {
        const providers = getUniqueProviders(displayModels);
        if (providers.length >= 2) {
          const providerQs = buildProviderQuestions(providers);
          return {
            effectiveModel: clientModel,
            originalModel: null,
            interceptResponse: {
              ...buildAskUserQuestionPayload(providerQs, true, displayModels),
              meta: { action: "Provider列表(AskUserQuestion)" },
            },
          };
        }
        // 单 provider 且模型过多 → AskUserQuestion 显示前 6 个 + 文本列出剩余
        const capped = displayModels.slice(0, MODELS_PER_GROUP * 2);
        const questions = buildModelQuestions(capped);
        const payload = buildAskUserQuestionPayload(questions, false);
        if (displayModels.length > capped.length) {
          const extra = displayModels.slice(capped.length).map((m, i) => `${capped.length + i + 1}. ${m}`).join("\n");
          const textBlock = { type: "text" as const, text: `更多模型:\n${extra}\n\n可输入 /select-model provider/model 选择` };
          const body = payload.body as Record<string, unknown>;
          body.content = [textBlock, ...(body.content as unknown[])];
        }
        return {
          effectiveModel: clientModel,
          originalModel: null,
          interceptResponse: {
            ...payload,
            meta: { action: "模型列表(AskUserQuestion)" },
          },
        };
      }
      // < TWO_STEP_THRESHOLD → AskUserQuestion 2 组
      const questions = buildModelQuestions(displayModels);
      return {
        effectiveModel: clientModel,
        originalModel: null,
        interceptResponse: {
          ...buildAskUserQuestionPayload(questions, false),
          meta: { action: "模型列表(AskUserQuestion)" },
        },
      };
    }
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

/** 从 "provider/model" 列表中提取去重的 provider 名称 */
function getUniqueProviders(models: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const m of models) {
    const sep = m.indexOf("/");
    if (sep > 0) {
      const p = m.substring(0, sep);
      if (!seen.has(p)) { seen.add(p); result.push(p); }
    }
  }
  return result;
}

/** 按 provider 筛选模型列表 */
function getModelsForProvider(models: string[], provider: string): string[] {
  const prefix = provider + "/";
  return models.filter(m => m.startsWith(prefix));
}

/** 查询所有可用的 provider_model 并构造文本列表响应 */
function buildSelectModelResponse(
  db: Database.Database,
  allowedModelsRaw: string | null | undefined,
  selectedModel?: string | null,
): Omit<InterceptResponse, "meta"> {
  const displayModels = buildDisplayModels(db, allowedModelsRaw);

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

/** 将模型列表分成最多 2 组 AskUserQuestion（每组 ≤3 个模型 + 1 个"不选择"） */
function buildModelQuestions(models: string[]): unknown[] {
  if (models.length <= MODELS_PER_GROUP) {
    const options = models.map(m => {
      const sep = m.indexOf("/");
      const provider = sep > 0 ? m.substring(0, sep) : "";
      return { label: m, description: provider || "模型" };
    });
    options.push({ label: SKIP_LABEL, description: "不切换模型" });
    return [{
      question: "请选择要使用的模型",
      header: "模型选择",
      options,
      multiSelect: false,
    }];
  }

  const g1 = models.slice(0, MODELS_PER_GROUP);
  const g2 = models.slice(MODELS_PER_GROUP, MODELS_PER_GROUP * 2);
  return [g1, g2].map((group, idx) => {
    const options = group.map(m => {
      const sep = m.indexOf("/");
      const provider = sep > 0 ? m.substring(0, sep) : "";
      return { label: m, description: provider || "模型" };
    });
    options.push({ label: SKIP_LABEL, description: "不切换模型" });
    return {
      question: `请选择要使用的模型（第${idx + 1}组）`,
      header: idx === 0 ? "模型选择" : "更多模型",
      options,
      multiSelect: false,
    };
  });
}

/** 构建 provider 选择的 AskUserQuestion questions（两步式第一步，每组 ≤3 个 provider + "不选择"） */
function buildProviderQuestions(providers: string[]): unknown[] {
  if (providers.length <= 3) {
    const options = providers.map(p => ({ label: p, description: `${p} 的模型` }));
    options.push({ label: SKIP_LABEL, description: "不切换模型" });
    return [{
      question: "请先选择模型提供商",
      header: "Provider",
      options,
      multiSelect: false,
    }];
  }
  const chunks: string[][] = [];
  for (let i = 0; i < providers.length && chunks.length < 4; i += 3) {
    chunks.push(providers.slice(i, i + 3));
  }
  return chunks.map((chunk, idx) => {
    const options = chunk.map(p => ({ label: p, description: `${p} 的模型` }));
    options.push({ label: SKIP_LABEL, description: "不切换模型" });
    return {
      question: chunks.length === 1
        ? "请先选择模型提供商"
        : `请选择模型提供商（第${idx + 1}组）`,
      header: idx === 0 ? "Provider" : `Provider(${idx + 1})`,
      options,
      multiSelect: false,
    };
  });
}

/** 构造「文本列表 + AskUserQuestion」组合响应 */
function buildAskUserQuestionPayload(
  questions: unknown[],
  isProvider: boolean,
  allModels?: string[],
): Omit<InterceptResponse, "meta"> {
  const prefix = isProvider ? TOOL_USE_ID_PROVIDER_PREFIX : TOOL_USE_ID_PREFIX;
  const toolUseId = `${prefix}${randomUUID()}`;

  const content: unknown[] = [];
  // 先输出完整模型列表文本
  if (allModels && allModels.length > 0) {
    const list = allModels.map((m, i) => `${i + 1}. ${m}`).join("\n");
    content.push({ type: "text", text: `可用模型列表:\n${list}` });
  }
  content.push({
    type: "tool_use",
    id: toolUseId,
    name: "AskUserQuestion",
    input: { questions },
  });

  return {
    statusCode: 200,
    body: {
      id: `msg-${randomUUID()}`,
      type: "message",
      role: "assistant",
      content,
      model: "router",
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  };
}

/** 生成注入到非流式响应中的模型信息标签 */
export function buildModelInfoTag(effectiveModel: string): string {
  return `<router-response type="${MODEL_INFO_TAG_TYPE}">当前模型: ${effectiveModel}</router-response>`;
}

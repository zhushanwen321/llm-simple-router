import { randomUUID } from "crypto";
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

export interface EnhancementMeta {
  router_tags_stripped: number;
  directive: { type: "select_model" | "router_model" | "router_command"; value: string } | null;
}

export interface EnhancementResult {
  body: Record<string, unknown>;
  effectiveModel: string;
  originalModel: string | null;
  interceptResponse: InterceptResponse | null;
  meta: EnhancementMeta;
}

/** 调用方传入的 routerKey 信息，从 FastifyRequest.routerKey 解耦 */
export interface RouterKeyInfo {
  id: string;
  name: string;
  allowed_models: string | null;
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

const EMPTY_META: EnhancementMeta = { router_tags_stripped: 0, directive: null };

/**
 * 在代理转发前应用代理增强逻辑（指令解析 + 会话记忆 + 模型替换 + 命令拦截）。
 * 仅当 proxy_enhancement.claude_code_enabled 开启时生效。
 *
 * 纯函数：不修改输入 body，返回变换后的新 body + 元数据。
 */
export function applyEnhancement(
  db: Database.Database,
  body: Record<string, unknown>,
  clientModel: string,
  sessionId: string | undefined,
  routerKey: RouterKeyInfo | undefined,
  enhancementConfig?: EnhancementConfig,
): EnhancementResult {
  const earlyReturn: EnhancementResult = {
    body, effectiveModel: clientModel, originalModel: null, interceptResponse: null, meta: EMPTY_META,
  };

  const enhancement = enhancementConfig ?? loadEnhancementConfig(db);

  if (!enhancement.claude_code_enabled) {
    return earlyReturn;
  }

  // 检测 AskUserQuestion 的 tool_result 回调（用户在 UI 上选择了模型或 provider）
  const toolResult = parseToolResult(body);
  if (toolResult.isRouterToolResult) {
    const routerKeyId = routerKey?.id ?? null;
    const nonSkipAnswers = toolResult.allAnswers.filter(a => a !== SKIP_LABEL);

    // 所有回答都是"不选择" → 取消
    if (nonSkipAnswers.length === 0) {
      return {
        body,
        effectiveModel: clientModel,
        originalModel: null,
        interceptResponse: {
          ...buildTextResponse("model-select-cancelled", "已取消选择"),
          meta: { action: "取消模型选择" },
        },
        meta: EMPTY_META,
      };
    }

    // 选择了多个 → 提示错误
    if (nonSkipAnswers.length > 1) {
      return {
        body,
        effectiveModel: clientModel,
        originalModel: null,
        interceptResponse: {
          ...buildTextResponse("model-select-error", "选择错误：只能选择一个模型或提供商，请重新输入 /select-model 选择"),
          meta: { action: "选择错误" },
        },
        meta: EMPTY_META,
      };
    }

    const answer = nonSkipAnswers[0];

    // 两步式：用户选择了 provider → 返回该 provider 的模型列表
    if (toolResult.isProviderSelection) {
      const allModels = buildDisplayModels(db, routerKey?.allowed_models ?? null);
      const providerModels = getModelsForProvider(allModels, answer);
      if (providerModels.length === 0) {
        return {
          body,
          effectiveModel: clientModel,
          originalModel: null,
          interceptResponse: {
            ...buildTextResponse("error", `未找到 provider: ${answer}`),
            meta: { action: "模型选择失败", detail: answer },
          },
          meta: EMPTY_META,
        };
      }
      const questions = buildModelQuestions(providerModels);
      return {
        body,
        effectiveModel: clientModel,
        originalModel: null,
        interceptResponse: {
          ...buildAskUserQuestionPayload(questions, false, providerModels),
          meta: { action: `模型列表(provider=${answer})` },
        },
        meta: EMPTY_META,
      };
    }

    // 模型选择（直接或两步式第二步）
    const resolvedClientModel = resolveProviderModel(db, answer);
    if (resolvedClientModel) {
      modelState.set(routerKeyId, answer, sessionId, clientModel, "command");
      return {
        body,
        effectiveModel: answer,
        originalModel: null,
        interceptResponse: {
          ...buildTextResponse("model-selected", `已选择模型: ${answer}`),
          meta: { action: "模型选择", detail: answer },
        },
        meta: EMPTY_META,
      };
    }
    return {
      body,
      effectiveModel: clientModel,
      originalModel: null,
      interceptResponse: {
        ...buildTextResponse("error", `未找到模型: ${answer}`),
        meta: { action: "模型选择失败", detail: answer },
      },
      meta: EMPTY_META,
    };
  }

  // 清理历史消息中的 <router-response> 标签（纯函数，返回新对象）
  const originalMessages = (body.messages as unknown[])?.length ?? 0;
  const cleaned = cleanRouterResponses(body);
  const cleanedMessages = (cleaned.messages as unknown[])?.length ?? 0;
  const tagsStripped = originalMessages - cleanedMessages;
  const currentBody: Record<string, unknown> = { ...body, messages: cleaned.messages };

  const directive = parseDirective(currentBody);

  // 命令拦截：select-model → 返回可用模型列表
  if (directive.isCommandMessage && directive.command?.startsWith("select-model")) {
    const routerKeyId = routerKey?.id ?? null;
    const parts = directive.command.trim().split(/\s+/);
    const arg = parts.length > 1 ? parts.slice(1).join(" ") : null;

    // 带参数：设置模型并返回确认
    if (arg && arg !== "") {
      const resolvedClientModel = resolveProviderModel(db, arg);
      if (!resolvedClientModel) {
        return {
          body: currentBody,
          effectiveModel: clientModel,
          originalModel: null,
          interceptResponse: {
            ...buildTextResponse("error", `未找到模型: ${arg}`),
            meta: { action: "模型选择失败", detail: arg },
          },
          meta: { router_tags_stripped: tagsStripped, directive: { type: "router_command", value: `select-model ${arg}` } },
        };
      }
      modelState.set(routerKeyId, arg, sessionId, clientModel, "command");
      return {
        body: currentBody,
        effectiveModel: arg,
        originalModel: null,
        interceptResponse: {
          ...buildSelectModelResponse(db, routerKey?.allowed_models ?? null, arg),
          meta: { action: "模型选择", detail: arg },
        },
        meta: { router_tags_stripped: tagsStripped, directive: { type: "router_command", value: `select-model ${arg}` } },
      };
    }

    // 无参数：返回模型列表
    if (hasAskUserQuestion(currentBody)) {
      const displayModels = buildDisplayModels(db, routerKey?.allowed_models ?? null);
      if (displayModels.length === 0) {
        return {
          body: currentBody,
          effectiveModel: clientModel,
          originalModel: null,
          interceptResponse: {
            ...buildTextResponse("model-list", "（无可用模型）"),
            meta: { action: "模型列表" },
          },
          meta: { router_tags_stripped: tagsStripped, directive: { type: "router_command", value: "select-model" } },
        };
      }
      // >= TWO_STEP_THRESHOLD 且多个 provider → 两步式：先选 provider
      if (displayModels.length >= TWO_STEP_THRESHOLD) {
        const providers = getUniqueProviders(displayModels);
        if (providers.length >= 2) {
          const providerQs = buildProviderQuestions(providers);
          return {
            body: currentBody,
            effectiveModel: clientModel,
            originalModel: null,
            interceptResponse: {
              ...buildAskUserQuestionPayload(providerQs, true, displayModels),
              meta: { action: "Provider列表(AskUserQuestion)" },
            },
            meta: { router_tags_stripped: tagsStripped, directive: { type: "router_command", value: "select-model" } },
          };
        }
        // 单 provider 且模型过多 → AskUserQuestion 显示前 6 个 + 文本列出剩余
        const capped = displayModels.slice(0, MODELS_PER_GROUP * 2);
        const questions = buildModelQuestions(capped);
        const payload = buildAskUserQuestionPayload(questions, false);
        if (displayModels.length > capped.length) {
          const extra = displayModels.slice(capped.length).map((m, i) => `${capped.length + i + 1}. ${m}`).join("\n");
          const textBlock = { type: "text" as const, text: `更多模型:\n${extra}\n\n可输入 /select-model provider/model 选择` };
          const payloadBody = payload.body as Record<string, unknown>;
          payloadBody.content = [textBlock, ...(payloadBody.content as unknown[])];
        }
        return {
          body: currentBody,
          effectiveModel: clientModel,
          originalModel: null,
          interceptResponse: {
            ...payload,
            meta: { action: "模型列表(AskUserQuestion)" },
          },
          meta: { router_tags_stripped: tagsStripped, directive: { type: "router_command", value: "select-model" } },
        };
      }
      // < TWO_STEP_THRESHOLD → AskUserQuestion 2 组
      const questions = buildModelQuestions(displayModels);
      return {
        body: currentBody,
        effectiveModel: clientModel,
        originalModel: null,
        interceptResponse: {
          ...buildAskUserQuestionPayload(questions, false),
          meta: { action: "模型列表(AskUserQuestion)" },
        },
        meta: { router_tags_stripped: tagsStripped, directive: { type: "router_command", value: "select-model" } },
      };
    }
    return {
      body: currentBody,
      effectiveModel: clientModel,
      originalModel: null,
      interceptResponse: {
        ...buildSelectModelResponse(db, routerKey?.allowed_models ?? null),
        meta: { action: "模型列表" },
      },
      meta: { router_tags_stripped: tagsStripped, directive: { type: "router_command", value: "select-model" } },
    };
  }

  if (directive.modelName) {
    // 内联模型指令 → resolveMapping 验证（client_model 格式）
    const resolvedDirective = resolveMapping(db, directive.modelName, { now: new Date() });
    if (resolvedDirective) {
      modelState.set(routerKey?.id ?? null, directive.modelName, sessionId, clientModel, "directive");
      const directiveBody = { ...currentBody, messages: directive.cleanedBody.messages };
      return {
        body: directiveBody,
        effectiveModel: directive.modelName,
        originalModel: clientModel,
        interceptResponse: null,
        meta: { router_tags_stripped: tagsStripped, directive: { type: directive.isCommandMessage ? "router_command" : "router_model", value: directive.modelName } },
      };
    }
    // 映射失败时保留原始请求（降级策略）
    return { body: currentBody, effectiveModel: clientModel, originalModel: null, interceptResponse: null, meta: { router_tags_stripped: tagsStripped, directive: null } };
  }

  // 无指令 → 查询会话记忆
  const remembered = modelState.get(routerKey?.id ?? null, sessionId);
  if (remembered) {
    // 优先尝试 provider_name/backend_model 格式（select-model 命令存储）
    // 直接保留该格式，resolveMapping 会解析出 provider + model
    const providerResolved = resolveProviderModel(db, remembered);
    if (providerResolved) {
      return {
        body: currentBody,
        effectiveModel: remembered,
        originalModel: clientModel,
        interceptResponse: null,
        meta: { router_tags_stripped: tagsStripped, directive: { type: "select_model", value: remembered } },
      };
    }
    // 回退到 client_model 格式（内联指令存储）
    const resolvedRemembered = resolveMapping(db, remembered, { now: new Date() });
    if (resolvedRemembered) {
      return {
        body: currentBody,
        effectiveModel: remembered,
        originalModel: clientModel,
        interceptResponse: null,
        meta: { router_tags_stripped: tagsStripped, directive: { type: "router_model", value: remembered } },
      };
    }
  }

  return { body: currentBody, effectiveModel: clientModel, originalModel: null, interceptResponse: null, meta: { router_tags_stripped: tagsStripped, directive: null } };
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

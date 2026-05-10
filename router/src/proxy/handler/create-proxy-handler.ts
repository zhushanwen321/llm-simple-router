/**
 * 统一代理处理器工厂 — 替代 openai.ts / anthropic.ts / responses.ts 三个独立文件。
 *
 * 工厂接受 { apiType, paths } 配置，返回 Fastify 插件：
 * - 注册 POST 路由到指定 paths
 * - apiType === "openai" 时额外注册 GET /v1/models
 * - 从 FormatRegistry 获取 FormatAdapter 用于错误格式化
 * - 创建 ProxyOrchestrator + ProxyPipeline
 * - 通过 executeFailoverLoop 处理请求
 */
import { randomUUID } from "crypto";
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from "fastify";
import Database from "better-sqlite3";
import fp from "fastify-plugin";
import { insertRequestLog, getAllProviders } from "../../db/index.js";
import { createErrorFormatter, type ErrorKind } from "../proxy-core.js";
import { createOrchestrator } from "../orchestration/orchestrator.js";
import { SemaphoreManager } from "../../core/concurrency/index.js";
import type { RequestTracker } from "../../core/monitor/index.js";
import { AdaptiveController } from "../../core/concurrency/index.js";
import { HTTP_OK, HTTP_BAD_GATEWAY, HTTP_CLIENT_CLOSED, MS_PER_SECOND } from "../../core/constants.js";
import { SERVICE_KEYS } from "../../core/container.js";
import type { ServiceContainer } from "../../core/container.js";
import type { FormatRegistry } from "../format/registry.js";
import type { ProxyAgentFactory } from "../transport/proxy-agent.js";
import { createPipelineContext } from "../pipeline/context.js";
import { proxyPipeline } from "../pipeline/pipeline.js";
import { executeFailoverLoop, type FailoverLoopDeps } from "./failover-loop.js";
import { loadEnhancementConfig } from "../routing/enhancement-config.js";
import { ToolLoopGuard, type SessionTracker } from "../../core/loop-prevention/index.js";
import { HTTP_UNPROCESSABLE_ENTITY } from "../../core/constants.js";
import { PipelineAbort } from "../pipeline/types.js";
import { applyToolRoundLimit } from "../patch/tool-round-limiter.js";
import { extractLastToolUse } from "./proxy-handler-utils.js";
import { parseModels } from "../../config/model-context.js";

// ---------- Factory config ----------

export interface ProxyHandlerConfig {
  /** API 类型：openai | openai-responses | anthropic */
  apiType: "openai" | "openai-responses" | "anthropic";
  /** 注册 POST 路由的路径列表 */
  paths: string[];
}

export interface ProxyHandlerOptions {
  db: Database.Database;
  container: ServiceContainer;
}

// ---------- Models handler (shared across openai/anthropic) ----------

const ANTHROPIC_DEFAULT_PAGE_SIZE = 20;
const ANTHROPIC_MAX_PAGE_SIZE = 1000;

function handleModelsRequest(db: Database.Database) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const allProviders = getAllProviders(db).filter(p => p.is_active);
    const modelMeta = new Map<string, { providerName: string; createdAt: string }>();
    for (const p of allProviders) {
      try {
        const models = parseModels(p.models || "[]");
        for (const m of models) {
          if (m.name && !modelMeta.has(m.name)) modelMeta.set(m.name, { providerName: p.name, createdAt: p.created_at });
        }
      } catch {
        continue;
      }
    }
    const sortedIds = [...modelMeta.keys()].sort();

    const isAnthropicFormat = !!request.headers["anthropic-version"];

    if (isAnthropicFormat) {
      const query = request.query as { limit?: string; before_id?: string; after_id?: string };
      const limit = Math.min(Math.max(parseInt(query.limit || ANTHROPIC_DEFAULT_PAGE_SIZE.toString(), 10) || ANTHROPIC_DEFAULT_PAGE_SIZE, 1), ANTHROPIC_MAX_PAGE_SIZE);

      let sliced: string[];
      let hasMore: boolean;

      if (query.after_id) {
        const idx = sortedIds.indexOf(query.after_id);
        const start = idx !== -1 ? idx + 1 : 0;
        sliced = sortedIds.slice(start, start + limit);
        hasMore = start + limit < sortedIds.length;
      } else if (query.before_id) {
        const endIdx = sortedIds.indexOf(query.before_id);
        const end = endIdx !== -1 ? endIdx : sortedIds.length;
        const start = Math.max(0, end - limit);
        sliced = sortedIds.slice(start, end);
        hasMore = start > 0;
      } else {
        sliced = sortedIds.slice(0, limit);
        hasMore = limit < sortedIds.length;
      }

      const data = sliced.map(id => ({
        type: "model" as const,
        id,
        display_name: id,
        created_at: modelMeta.get(id)!.createdAt,
      }));

      return reply.code(HTTP_OK).send({
        data,
        has_more: hasMore,
        first_id: data.length > 0 ? data[0].id : null,
        last_id: data.length > 0 ? data[data.length - 1].id : null,
      });
    }

    // OpenAI 格式
    const data = sortedIds.map(id => ({
      id,
      object: "model" as const,
      created: Math.floor(new Date(modelMeta.get(id)!.createdAt).getTime() / MS_PER_SECOND),
      owned_by: modelMeta.get(id)!.providerName,
    }));

    return reply.code(HTTP_OK).send({
      object: "list",
      data,
    });
  };
}

// ---------- Enhancement preprocessing (extracted from old handleProxyRequest) ----------

const TIER2_LOOP_THRESHOLD = 2;

function applyEnhancementPreprocess(
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: import("../pipeline/types.js").PipelineContext,
  db: Database.Database,
  container: ServiceContainer,
): void {
  const enhancementConfig = loadEnhancementConfig(db);
  const apiType = ctx.apiType as "openai" | "openai-responses" | "anthropic";
  const sessionId = ctx.sessionId;

  // 工具轮数限制
  if (enhancementConfig.tool_round_limit_enabled) {
    const roundResult = applyToolRoundLimit(ctx.body, apiType);
    if (roundResult.injected) {
      ctx.body = roundResult.body;
      ctx.snapshot.add({ stage: "tool_round_limit", action: "inject_warning", rounds: roundResult.rounds });
      request.log.info({ sessionId, rounds: roundResult.rounds }, "Tool round limit reached, injecting warning prompt");
    }
  }

  // 工具循环检测
  if (!enhancementConfig.tool_call_loop_enabled || !sessionId) return;

  const sessionTracker = container.resolve<SessionTracker>(SERVICE_KEYS.sessionTracker);
  if (!sessionTracker) return;

  const routerKeyId = (request.routerKey as { id?: string } | undefined)?.id ?? null;
  const sessionKey = routerKeyId ? `${routerKeyId}:${sessionId}` : sessionId;
  const lastToolUse = extractLastToolUse(ctx.body);
  if (!lastToolUse) return;

  const toolGuard = new ToolLoopGuard(sessionTracker, {
    enabled: true,
    minConsecutiveCount: 3,
    detectorConfig: { n: 6, windowSize: 500, repeatThreshold: 5 },
  });
  const checkResult = toolGuard.check(sessionKey, lastToolUse);
  if (!checkResult.detected) return;

  const loopCount = sessionTracker.getLoopCount(sessionKey);
  if (loopCount === 1) {
    ctx.body = toolGuard.injectLoopBreakPrompt(ctx.body, apiType, lastToolUse.toolName);
    ctx.snapshot.add({ stage: "tool_guard", action: "inject_break_prompt", tool: lastToolUse.toolName });
    request.log.warn({ sessionId, toolName: lastToolUse.toolName, loopCount },
      "Tool call loop detected, injecting break prompt");
  } else if (loopCount === TIER2_LOOP_THRESHOLD) {
    throw new PipelineAbort(HTTP_UNPROCESSABLE_ENTITY, {
      error: {
        type: "tool_call_loop_detected",
        message: `检测到工具调用循环（连续重复调用 "${lastToolUse.toolName}"）。请求已中断。`,
        suggestion: "请回顾对话历史，停止重复调用工具，直接告知用户当前的进展和遇到的问题。",
      },
    });
  } else {
    request.log.warn({ sessionId, toolName: lastToolUse.toolName, loopCount },
      "Tool call loop detected, hard disconnecting");
    throw new PipelineAbort(HTTP_CLIENT_CLOSED, { _disconnect: true });
  }
}

// ---------- Factory ----------

export function createProxyHandler(config: ProxyHandlerConfig) {
  const { apiType, paths } = config;

  const handlerRaw: FastifyPluginCallback<ProxyHandlerOptions> = (app, opts, done) => {
    const { db, container } = opts;

    const orchestrator = createOrchestrator(
      container.resolve<SemaphoreManager>(SERVICE_KEYS.semaphoreManager),
      container.resolve<RequestTracker>(SERVICE_KEYS.tracker),
      container.resolve<AdaptiveController>(SERVICE_KEYS.adaptiveController),
    );

    // 从 FormatRegistry 获取 adapter 用于错误格式化和 beforeSendProxy
    const formatRegistry = container.resolve<FormatRegistry>(SERVICE_KEYS.formatRegistry);
    const adapter = formatRegistry.getAdapter(apiType);

    // 创建错误格式化器
    const errorMeta: Record<ErrorKind, { type: string; code: string }> = adapter?.errorMeta ?? {
      modelNotFound: { type: "invalid_request_error", code: "model_not_found" },
      modelNotAllowed: { type: "invalid_request_error", code: "model_not_allowed" },
      providerUnavailable: { type: "server_error", code: "provider_unavailable" },
      providerTypeMismatch: { type: "server_error", code: "provider_type_mismatch" },
      upstreamConnectionFailed: { type: "upstream_error", code: "upstream_connection_failed" },
      concurrencyQueueFull: { type: "server_error", code: "concurrency_queue_full" },
      concurrencyTimeout: { type: "server_error", code: "concurrency_timeout" },
      promptTooLong: { type: "invalid_request_error", code: "context_window_exceeded" },
    };

    const apiTypeErrors = createErrorFormatter(
      (kind, message) => ({ error: { message, ...errorMeta[kind] } }),
    );

    // 默认 upstream path 从 adapter 获取
    const defaultUpstreamPath = adapter?.defaultPath ?? "/v1/chat/completions";

    const handleRequest = async (request: FastifyRequest, reply: FastifyReply) => {
      if (!orchestrator) {
        const body = request.body as Record<string, unknown> | undefined;
        insertRequestLog(db, {
          id: randomUUID(), api_type: apiType, model: (body?.model as string) || null,
          provider_id: null, status_code: HTTP_BAD_GATEWAY, latency_ms: 0, is_stream: 0,
          error_message: "Orchestrator not available (missing semaphore or tracker)",
          created_at: new Date().toISOString(),
          client_request: JSON.stringify({ headers: request.headers }),
          router_key_id: request.routerKey?.id ?? null,
        });
        const e = apiTypeErrors.providerUnavailable();
        return reply.code(e.statusCode).send(e.body);
      }

      // Socket error handling
      const socketErrorHandler = (err: Error) => request.log.debug({ err }, "client socket error");
      request.raw.socket.on("error", socketErrorHandler);
      reply.raw.on("close", () => {
        request.raw.socket.removeListener("error", socketErrorHandler);
      });

      // 创建 pipeline context
      const ctx = createPipelineContext(request, reply, apiType);

      // 注入 DB 到 metadata（hooks 需要访问 settings/写入数据）
      ctx.metadata.set("db", db);

      // 执行 pre_route 阶段 hooks（client-detection 在此阶段设置 client_type / session_id）
      await proxyPipeline.emit("pre_route", ctx).catch(err => {
        request.log.error({ err }, "pre_route hook failed");
      });

      // 增强预处理（工具轮数限制 + 工具循环检测）
      try {
        applyEnhancementPreprocess(request, reply, ctx, db, container);
      } catch (e) {
        if (e instanceof PipelineAbort) {
          if (e.statusCode === HTTP_CLIENT_CLOSED && (e.body as Record<string, unknown>)?._disconnect) {
            reply.raw.destroy();
            return reply;
          }
          return reply.code(e.statusCode).send(e.body);
        }
        throw e;
      }

      const deps: FailoverLoopDeps = {
        db,
        container,
        orchestrator,
        proxyAgentFactory: container.resolve<ProxyAgentFactory>(SERVICE_KEYS.proxyAgentFactory),
      };

      const result = await executeFailoverLoop(ctx, apiTypeErrors, deps, defaultUpstreamPath, adapter ?? {
        apiType,
        defaultPath: defaultUpstreamPath,
        errorMeta,
        formatError: (message: string) => ({ error: { message } }),
      });

      return result;
    };

    // 注册 POST 路由
    for (const path of paths) {
      app.post(path, handleRequest);
    }

    // OpenAI 特有：GET /v1/models
    if (apiType === "openai") {
      const modelsHandler = handleModelsRequest(db);
      app.get("/v1/models", modelsHandler);
      app.get("/models", modelsHandler);
    }

    done();
  };

  return fp(handlerRaw, { name: `${apiType}-proxy` });
}

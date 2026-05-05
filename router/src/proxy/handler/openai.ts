import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import fp from "fastify-plugin";
import { getActiveProvidersWithModels, insertRequestLog } from "../../db/index.js";
import { createErrorFormatter, type ProxyErrorResponse } from "../proxy-core.js";
import type { ErrorKind } from "../proxy-core.js";
import { handleProxyRequest, type RouteHandlerDeps } from "./proxy-handler.js";
import { createOrchestrator } from "../orchestration/orchestrator.js";
import { SemaphoreManager } from "@llm-router/core/concurrency";
import type { RequestTracker } from "@llm-router/core/monitor";
import { AdaptiveController } from "@llm-router/core/concurrency";
import { HTTP_BAD_GATEWAY } from "../../core/constants.js";
import { SERVICE_KEYS } from "../../core/container.js";

export interface OpenaiProxyOptions {
  db: Database.Database;
  container: import("../../core/container.js").ServiceContainer;
}

const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";
const MODELS_PATH = "/v1/models";

/** OpenAI 兼容路径（不带 /v1 前缀），供部分客户端使用 */
const CHAT_COMPLETIONS_COMPAT_PATH = "/chat/completions";
const MODELS_COMPAT_PATH = "/models";

const OPENAI_ERROR_META: Record<ErrorKind, { type: string; code: string }> = {
  modelNotFound: { type: "invalid_request_error", code: "model_not_found" },
  modelNotAllowed: { type: "invalid_request_error", code: "model_not_allowed" },
  providerUnavailable: { type: "server_error", code: "provider_unavailable" },
  providerTypeMismatch: { type: "server_error", code: "provider_type_mismatch" },
  upstreamConnectionFailed: { type: "upstream_error", code: "upstream_connection_failed" },
  concurrencyQueueFull: { type: "server_error", code: "concurrency_queue_full" },
  concurrencyTimeout: { type: "server_error", code: "concurrency_timeout" },
  promptTooLong: { type: "invalid_request_error", code: "context_window_exceeded" },
};

const openaiErrors = createErrorFormatter(
  (kind, message) => ({ error: { message, ...OPENAI_ERROR_META[kind] } }),
);

function sendError(reply: FastifyReply, e: ProxyErrorResponse) {
  return reply.code(e.statusCode).send(e.body);
}

const openaiProxyRaw: FastifyPluginCallback<OpenaiProxyOptions> = (app, opts, done) => {
  const { db, container } = opts;

  const orchestrator = createOrchestrator(
    container.resolve<SemaphoreManager>(SERVICE_KEYS.semaphoreManager),
    container.resolve<RequestTracker>(SERVICE_KEYS.tracker),
    container.resolve<AdaptiveController>(SERVICE_KEYS.adaptiveController),
  );

  const handleChatCompletions = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!orchestrator) {
      const body = request.body as Record<string, unknown> | undefined;
      insertRequestLog(db, {
        id: randomUUID(), api_type: "openai", model: (body?.model as string) || null,
        provider_id: null, status_code: HTTP_BAD_GATEWAY, latency_ms: 0, is_stream: 0,
        error_message: "Orchestrator not available (missing semaphore or tracker)",
        created_at: new Date().toISOString(),
        client_request: JSON.stringify({ headers: request.headers }),
        router_key_id: request.routerKey?.id ?? null,
      });
      return sendError(reply, openaiErrors.providerUnavailable());
    }
    const deps: RouteHandlerDeps = { db, orchestrator, container };
    return handleProxyRequest(request, reply, "openai", CHAT_COMPLETIONS_PATH, openaiErrors, deps, {
      beforeSendProxy: (body, isStream) => {
        if (isStream && !body.stream_options) {
          body.stream_options = { include_usage: true };
        }
      },
    });
  };

  // 规范路径 + 兼容路径（不带 /v1 前缀）
  app.post(CHAT_COMPLETIONS_PATH, handleChatCompletions);
  app.post(CHAT_COMPLETIONS_COMPAT_PATH, handleChatCompletions);

  const handleModels = async (request: FastifyRequest, reply: FastifyReply) => {
    // 聚合所有活跃 provider 的模型列表
    const providers = getActiveProvidersWithModels(db);
    const modelMeta = new Map<string, string>(); // modelId → providerName
    for (const p of providers) {
      try {
        const models: string[] = JSON.parse(p.models || '[]');
        for (const m of models) {
          if (!modelMeta.has(m)) modelMeta.set(m, p.name);
        }
      } catch { /* skip invalid JSON */ }
    }
    const sortedIds = [...modelMeta.keys()].sort();

    // 根据请求头判断响应格式：Anthropic 客户端发送 anthropic-version 头
    const isAnthropicFormat = !!request.headers['anthropic-version'];

    if (isAnthropicFormat) {
      // Anthropic 格式: { data: [...], has_more, first_id, last_id }
      const query = request.query as { limit?: string; before_id?: string; after_id?: string };
      const limit = Math.min(Math.max(parseInt(query.limit || '20', 10) || 20, 1), 1000);

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
        type: 'model' as const,
        id,
        display_name: id,
        created_at: new Date().toISOString(),
      }));

      return reply.code(200).send({
        data,
        has_more: hasMore,
        first_id: data.length > 0 ? data[0].id : null,
        last_id: data.length > 0 ? data[data.length - 1].id : null,
      });
    }

    // OpenAI 格式: { object: "list", data: [...] }
    const data = sortedIds.map(id => ({
      id,
      object: 'model' as const,
      created: Math.floor(Date.now() / 1000),
      owned_by: modelMeta.get(id) ?? 'llm-router',
    }));

    return reply.code(200).send({
      object: 'list',
      data,
    });
  };

  // 规范路径 + 兼容路径
  app.get(MODELS_PATH, handleModels);
  app.get(MODELS_COMPAT_PATH, handleModels);

  done();
};

export const openaiProxy = fp(openaiProxyRaw, { name: "openai-proxy" });

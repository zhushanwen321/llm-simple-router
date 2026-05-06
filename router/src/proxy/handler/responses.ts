import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import fp from "fastify-plugin";
import { insertRequestLog } from "../../db/index.js";
import { createErrorFormatter, type ProxyErrorResponse } from "../proxy-core.js";
import type { ErrorKind } from "../proxy-core.js";
import { handleProxyRequest, type RouteHandlerDeps } from "./proxy-handler.js";
import { createOrchestrator } from "../orchestration/orchestrator.js";
import { SemaphoreManager } from "@llm-router/core/concurrency";
import type { RequestTracker } from "@llm-router/core/monitor";
import { AdaptiveController } from "@llm-router/core/concurrency";
import { HTTP_BAD_GATEWAY } from "../../core/constants.js";
import { SERVICE_KEYS } from "../../core/container.js";
import type { ProxyAgentFactory } from "../transport/proxy-agent.js";

export interface ResponsesProxyOptions {
  db: Database.Database;
  container: import("../../core/container.js").ServiceContainer;
}

const RESPONSES_PATH = "/v1/responses";
const RESPONSES_COMPAT_PATH = "/responses";

const RESPONSES_ERROR_META: Record<ErrorKind, { type: string; code: string }> = {
  modelNotFound: { type: "invalid_request_error", code: "model_not_found" },
  modelNotAllowed: { type: "invalid_request_error", code: "model_not_allowed" },
  providerUnavailable: { type: "server_error", code: "provider_unavailable" },
  providerTypeMismatch: { type: "server_error", code: "provider_type_mismatch" },
  upstreamConnectionFailed: { type: "upstream_error", code: "upstream_connection_failed" },
  concurrencyQueueFull: { type: "server_error", code: "concurrency_queue_full" },
  concurrencyTimeout: { type: "server_error", code: "concurrency_timeout" },
  promptTooLong: { type: "invalid_request_error", code: "context_window_exceeded" },
};

const responsesErrors = createErrorFormatter(
  (kind, message) => ({ error: { message, ...RESPONSES_ERROR_META[kind] } }),
);

function sendError(reply: FastifyReply, e: ProxyErrorResponse) {
  return reply.code(e.statusCode).send(e.body);
}

const responsesProxyRaw: FastifyPluginCallback<ResponsesProxyOptions> = (app, opts, done) => {
  const { db, container } = opts;

  const orchestrator = createOrchestrator(
    container.resolve<SemaphoreManager>(SERVICE_KEYS.semaphoreManager),
    container.resolve<RequestTracker>(SERVICE_KEYS.tracker),
    container.resolve<AdaptiveController>(SERVICE_KEYS.adaptiveController),
  );

  const handleResponses = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!orchestrator) {
      const body = request.body as Record<string, unknown> | undefined;
      insertRequestLog(db, {
        id: randomUUID(), api_type: "openai-responses", model: (body?.model as string) || null,
        provider_id: null, status_code: HTTP_BAD_GATEWAY, latency_ms: 0, is_stream: 0,
        error_message: "Orchestrator not available",
        created_at: new Date().toISOString(),
        client_request: JSON.stringify({ headers: request.headers }),
        router_key_id: request.routerKey?.id ?? null,
      });
      return sendError(reply, responsesErrors.providerUnavailable());
    }
    const deps: RouteHandlerDeps = { db, orchestrator, container, proxyAgentFactory: container.resolve<ProxyAgentFactory>(SERVICE_KEYS.proxyAgentFactory) };
    return handleProxyRequest(request, reply, "openai-responses", RESPONSES_PATH, responsesErrors, deps);
  };

  app.post(RESPONSES_PATH, handleResponses);
  app.post(RESPONSES_COMPAT_PATH, handleResponses);

  done();
};

export const responsesProxy = fp(responsesProxyRaw, { name: "responses-proxy" });

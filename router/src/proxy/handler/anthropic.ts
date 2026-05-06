import Database from "better-sqlite3";
import type { FastifyPluginCallback } from "fastify";
import { randomUUID } from "crypto";
import fp from "fastify-plugin";
import { insertRequestLog } from "../../db/index.js";
import { createErrorFormatter } from "../proxy-core.js";
import type { ErrorKind } from "../proxy-core.js";
import { handleProxyRequest, type RouteHandlerDeps } from "./proxy-handler.js";
import { createOrchestrator } from "../orchestration/orchestrator.js";
import { SemaphoreManager } from "@llm-router/core/concurrency";
import type { RequestTracker } from "@llm-router/core/monitor";
import { AdaptiveController } from "@llm-router/core/concurrency";
import { HTTP_BAD_GATEWAY } from "../../core/constants.js";
import { SERVICE_KEYS } from "../../core/container.js";
import type { ProxyAgentFactory } from "../transport/proxy-agent.js";

export interface AnthropicProxyOptions {
  db: Database.Database;
  container: import("../../core/container.js").ServiceContainer;
}

const MESSAGES_PATH = "/v1/messages";

const ANTHROPIC_ERROR_TYPE: Record<ErrorKind, string> = {
  modelNotFound: "not_found_error",
  modelNotAllowed: "forbidden_error",
  providerUnavailable: "api_error",
  providerTypeMismatch: "api_error",
  upstreamConnectionFailed: "upstream_error",
  concurrencyQueueFull: "api_error",
  concurrencyTimeout: "api_error",
  promptTooLong: "invalid_request_error",
};

const anthropicErrors = createErrorFormatter(
  (kind, message) => ({ type: "error", error: { type: ANTHROPIC_ERROR_TYPE[kind], message } }),
);

const anthropicProxyRaw: FastifyPluginCallback<AnthropicProxyOptions> = (app, opts, done) => {
  const { db, container } = opts;

  const orchestrator = createOrchestrator(
    container.resolve<SemaphoreManager>(SERVICE_KEYS.semaphoreManager),
    container.resolve<RequestTracker>(SERVICE_KEYS.tracker),
    container.resolve<AdaptiveController>(SERVICE_KEYS.adaptiveController),
  );

  app.post(MESSAGES_PATH, async (request, reply) => {
    if (!orchestrator) {
      const body = request.body as Record<string, unknown> | undefined;
      insertRequestLog(db, {
        id: randomUUID(), api_type: "anthropic", model: (body?.model as string) || null,
        provider_id: null, status_code: HTTP_BAD_GATEWAY, latency_ms: 0, is_stream: 0,
        error_message: "Orchestrator not available (missing semaphore or tracker)",
        created_at: new Date().toISOString(),
        client_request: JSON.stringify({ headers: request.headers }),
        router_key_id: request.routerKey?.id ?? null,
      });
      const e = anthropicErrors.providerUnavailable();
      return reply.code(e.statusCode).send(e.body);
    }
    const deps: RouteHandlerDeps = { db, orchestrator, container, proxyAgentFactory: container.resolve<ProxyAgentFactory>(SERVICE_KEYS.proxyAgentFactory) };
    return handleProxyRequest(request, reply, "anthropic", MESSAGES_PATH, anthropicErrors, deps);
  });

  done();
};

export const anthropicProxy = fp(anthropicProxyRaw, { name: "anthropic-proxy" });

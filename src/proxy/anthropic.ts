import Database from "better-sqlite3";
import type { FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";
import type { ProxyErrorFormatter } from "./proxy-core.js";
import { handleProxyRequest, type RouteHandlerDeps } from "./proxy-handler.js";
import { ProxyOrchestrator } from "./orchestrator.js";
import { SemaphoreScope } from "./scope.js";
import { TrackerScope } from "./scope.js";
import { ResilienceLayer } from "./resilience.js";
import { RetryRuleMatcher } from "./retry-rules.js";
import { ProviderSemaphoreManager } from "./semaphore.js";
import type { RequestTracker } from "../monitor/request-tracker.js";

export interface AnthropicProxyOptions {
  db: Database.Database;
  streamTimeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  matcher?: RetryRuleMatcher;
  semaphoreManager?: ProviderSemaphoreManager;
  tracker?: RequestTracker;
}

const MESSAGES_PATH = "/v1/messages";

const anthropicErrors: ProxyErrorFormatter = {
  modelNotFound: (model) => ({
    statusCode: 404,
    body: { type: "error", error: { type: "not_found_error", message: `Model '${model}' is not configured` } },
  }),
  modelNotAllowed: (model) => ({
    statusCode: 403,
    body: { type: "error", error: { type: "forbidden_error", message: `Model '${model}' is not allowed for this API key` } },
  }),
  providerUnavailable: () => ({
    statusCode: 503,
    body: { type: "error", error: { type: "api_error", message: "Provider unavailable" } },
  }),
  providerTypeMismatch: () => ({
    statusCode: 500,
    body: { type: "error", error: { type: "api_error", message: "Provider type mismatch for this endpoint" } },
  }),
  upstreamConnectionFailed: () => ({
    statusCode: 502,
    body: { type: "error", error: { type: "upstream_error", message: "Failed to connect to upstream service" } },
  }),
  concurrencyQueueFull: (providerId) => ({
    statusCode: 503,
    body: { type: "error", error: { type: "api_error", message: `Provider '${providerId}' concurrency queue is full` } },
  }),
  concurrencyTimeout: (providerId, timeoutMs) => ({
    statusCode: 504,
    body: { type: "error", error: { type: "api_error", message: `Provider '${providerId}' concurrency wait timeout (${timeoutMs}ms)` } },
  }),
};

const anthropicProxyRaw: FastifyPluginCallback<AnthropicProxyOptions> = (app, opts, done) => {
  const { db, streamTimeoutMs, retryMaxAttempts, retryBaseDelayMs, matcher, semaphoreManager, tracker } = opts;

  const resilience = new ResilienceLayer();
  const semaphoreScope = semaphoreManager ? new SemaphoreScope(semaphoreManager) : undefined;
  const trackerScope = tracker ? new TrackerScope(tracker) : undefined;
  const orchestrator = (semaphoreScope && trackerScope)
    ? new ProxyOrchestrator({ semaphoreScope, trackerScope, resilience })
    : undefined;

  app.post(MESSAGES_PATH, async (request, reply) => {
    if (!orchestrator) {
      const e = anthropicErrors.providerUnavailable();
      return reply.status(e.statusCode).send(e.body);
    }
    const deps: RouteHandlerDeps = { db, streamTimeoutMs, retryMaxAttempts, retryBaseDelayMs, matcher, tracker, orchestrator };
    return handleProxyRequest(request, reply, "anthropic", MESSAGES_PATH, anthropicErrors, deps);
  });

  done();
};

export const anthropicProxy = fp(anthropicProxyRaw, { name: "anthropic-proxy" });

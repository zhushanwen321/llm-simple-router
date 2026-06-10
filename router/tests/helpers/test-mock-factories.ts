/**
 * Shared mock factories for unit tests.
 * Eliminates duplication of makeErrors / makeMockReply / makeMockRequest / makeRCtx
 * across test files (iteration-setup, resilience-processor, etc.).
 */
import { vi } from "vitest";
import type Database from "better-sqlite3";
import type { ProxyErrorFormatter } from "../../src/proxy/proxy-core.js";
import type { RejectParams } from "../../src/proxy/handler/reject-helpers.js";
import type { FastifyReply, FastifyRequest } from "fastify";

// ---------- Error constants (realistic shapes) ----------

const ERROR_502 = { statusCode: 502, body: { error: { message: "Upstream connection failed" } } };
const ERROR_503 = { statusCode: 503, body: { error: { message: "Queue full" } } };
const ERROR_504 = { statusCode: 504, body: { error: { message: "Timeout" } } };

// ---------- Factories ----------

export function makeErrors(): ProxyErrorFormatter {
  return {
    modelNotFound: () => ({ statusCode: 404, body: {} }),
    modelNotAllowed: () => ({ statusCode: 403, body: {} }),
    providerUnavailable: () => ERROR_503,
    providerTypeMismatch: () => ({ statusCode: 400, body: {} }),
    upstreamConnectionFailed: () => ERROR_502,
    concurrencyQueueFull: () => ERROR_503,
    concurrencyTimeout: () => ERROR_504,
    promptTooLong: () => ({ statusCode: 400, body: {} }),
    unsupportedModality: () => ({ statusCode: 400, body: {} }),
  };
}

export function makeMockReply(): FastifyReply {
  const codeFn = vi.fn().mockReturnThis();
  const sendFn = vi.fn().mockReturnThis();
  const headerFn = vi.fn().mockReturnThis();
  return {
    code: codeFn,
    send: sendFn,
    header: headerFn,
    raw: { headersSent: false },
    statusCode: 200,
  } as unknown as FastifyReply;
}

export function makeMockRequest(): FastifyRequest {
  return {
    log: { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
    headers: {},
  } as unknown as FastifyRequest;
}

export function makeRCtx(db: Database.Database): RejectParams {
  return {
    db,
    logId: "test-log-id",
    apiType: "openai",
    model: "gpt-4",
    startTime: Date.now(),
    isStream: false,
    routerKeyId: null,
    originalBody: { model: "gpt-4", messages: [] },
    clientHeaders: {},
    isFailover: false,
    originalRequestId: null,
    sessionId: undefined,
    mappingReason: "direct_format",
  };
}

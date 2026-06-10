/**
 * Unit tests for processResilienceResult / handleResilienceError
 * (extracted from failover-loop).
 *
 * Covers error classification:
 * - PipelineAbort → reply with statusCode
 * - ProviderSwitchNeeded → continue (failover)
 * - SemaphoreQueueFullError → reply 503
 * - SemaphoreTimeoutError → reply 504
 * - AbortError → reply without logging
 * - Unknown error → reply 502 + insertRequestLog
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import Database from "better-sqlite3";
import { processResilienceResult } from "../src/proxy/handler/resilience-processor.js";
import { ProviderSwitchNeeded, SemaphoreQueueFullError, SemaphoreTimeoutError } from "../src/core/errors.js";
import { PipelineAbort } from "../src/proxy/pipeline/types.js";
import { RetryRuleMatcher } from "../src/proxy/orchestration/retry-rules.js";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { hashPassword } from "../src/utils/password.js";
import type { Target, ResolvedEndpoint } from "../src/core/types.js";
import type { PipelineContext } from "../src/proxy/pipeline/types.js";
import type { ProxyOrchestrator } from "../src/proxy/orchestration/orchestrator.js";
import { makeErrors, makeMockReply, makeMockRequest, makeRCtx } from "./helpers/test-mock-factories.js";

// ---------- Local mock factories ----------

function makeResolvedEndpoint(): ResolvedEndpoint {
  return {
    api_type: "openai",
    base_url: "https://api.example.com",
    upstream_path: null,
    api_key: "test-key",
    needs_transform: false,
  };
}

function makePipelineContext(): PipelineContext {
  return {
    request: makeMockRequest(),
    reply: makeMockReply(),
    rawBody: { model: "gpt-4", messages: [] },
    clientModel: "gpt-4",
    apiType: "openai",
    body: { model: "gpt-4", messages: [] },
    isStream: false,
    resolved: null,
    provider: null,
    effectiveUpstreamPath: "/v1/chat/completions",
    effectiveApiType: "openai",
    injectedHeaders: {},
    metadata: new Map<string, unknown>(),
    logId: "test-log-id",
    rootLogId: null,
    transportResult: null,
  } as PipelineContext;
}

function makeProvider() {
  return {
    id: "test-provider",
    name: "Test",
    api_type: "openai",
    base_url: "https://api.example.com",
    upstream_path: null,
    api_key: "key",
    models: "[]",
    is_active: 1,
    max_concurrency: 10,
    queue_timeout_ms: 30000,
    max_queue_size: 100,
    adaptive_enabled: 0,
    proxy_type: null,
    proxy_url: null,
    proxy_username: null,
    proxy_password: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeAdapter() {
  return {
    apiType: "openai",
    defaultPath: "/v1/chat/completions",
    errorMeta: {},
    formatError: (message: string) => ({ error: { message, type: "server_error" } }),
  };
}

function makeBaseParams(overrides: Record<string, unknown> = {}) {
  const db = initDatabase(":memory:") as Database.Database;
  setSetting(db, "password_hash", hashPassword("test"));
  setSetting(db, "encryption_key", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

  return {
    orchestrator: {
      handle: vi.fn(),
    } as unknown as ProxyOrchestrator,
    request: makeMockRequest(),
    reply: makeMockReply(),
    clientApiType: "openai" as const,
    resolved: { backend_model: "gpt-4", provider_id: "test-provider" } as Target,
    provider: makeProvider(),
    clientModel: "gpt-4",
    isStream: false,
    logId: "test-log-id",
    sessionId: undefined,
    clientReq: "{}",
    upstreamReqBase: "{}",
    effectiveMappingReason: "direct_format" as const,
    retryBaseDelayMs: 0,
    isFailover: false,
    matcher: new RetryRuleMatcher(),
    transportFn: vi.fn(),
    concurrencyOverride: undefined,
    db,
    tracker: undefined,
    usageWindowTracker: undefined,
    errors: makeErrors(),
    rCtx: makeRCtx(db),
    pipelineSnapshot: "[]",
    flushCurrentErrors: vi.fn(),
    adapter: makeAdapter(),
    logFileWriter: undefined,
    resolvedEndpoint: makeResolvedEndpoint(),
    rootLogId: "root-log-id",
    isFailoverIteration: false,
    ctx: makePipelineContext(),
    routerKeyId: null,
    lastFailoverTrigger: null,
    startTime: Date.now(),
    ...overrides,
  };
}

// ---------- Tests ----------

describe("processResilienceResult - error handling", () => {
  it("should handle PipelineAbort by replying with the abort statusCode", async () => {
    const params = makeBaseParams();
    const abort = new PipelineAbort(429, { error: { message: "Rate limited" } });
    (params.orchestrator.handle as Mock).mockRejectedValue(abort);

    const result = await processResilienceResult(params);

    expect(result.action).toBe("reply");
    if (result.action === "reply") {
      expect(result.reply.code).toHaveBeenCalledWith(429);
    }
  });

  it("should handle ProviderSwitchNeeded by continuing to next target", async () => {
    const reply = makeMockReply();
    const params = makeBaseParams({ reply, isFailover: true });
    const switchNeeded = new ProviderSwitchNeeded("other-provider");
    (params.orchestrator.handle as Mock).mockRejectedValue(switchNeeded);

    const result = await processResilienceResult(params);

    expect(result.action).toBe("continue");
    if (result.action === "continue") {
      expect(result.trigger).toBe("ProviderSwitchNeeded");
    }
  });

  it("should handle SemaphoreQueueFullError by replying 503", async () => {
    const params = makeBaseParams();
    const queueFull = new SemaphoreQueueFullError("test-provider");
    (params.orchestrator.handle as Mock).mockRejectedValue(queueFull);

    const result = await processResilienceResult(params);

    expect(result.action).toBe("reply");
    if (result.action === "reply") {
      expect(result.reply.code).toHaveBeenCalledWith(503);
    }
  });

  it("should handle SemaphoreTimeoutError by replying 504", async () => {
    const params = makeBaseParams();
    const timeout = new SemaphoreTimeoutError("test-provider", 5000);
    (params.orchestrator.handle as Mock).mockRejectedValue(timeout);

    const result = await processResilienceResult(params);

    expect(result.action).toBe("reply");
    if (result.action === "reply") {
      expect(result.reply.code).toHaveBeenCalledWith(504);
    }
  });

  it("should handle AbortError by replying without writing error log", async () => {
    const params = makeBaseParams();
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    (params.orchestrator.handle as Mock).mockRejectedValue(abortErr);

    const result = await processResilienceResult(params);

    expect(result.action).toBe("reply");
  });

  it("should handle unknown error by replying 502 and inserting request log", async () => {
    const params = makeBaseParams();
    (params.orchestrator.handle as Mock).mockRejectedValue(new Error("unknown failure"));

    const result = await processResilienceResult(params);

    expect(result.action).toBe("reply");
    if (result.action === "reply") {
      expect(params.reply.code).toHaveBeenCalledWith(502);
    }
    // Verify request log was inserted
    const row = (params.db as Database.Database).prepare(
      "SELECT error_message FROM request_logs WHERE id = ?",
    ).get("test-log-id") as { error_message: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.error_message).toContain("unknown failure");
  });
});

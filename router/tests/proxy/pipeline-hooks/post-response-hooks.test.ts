/**
 * TC-6-01: builtin:stream-timeout writes SSE error event
 * TC-6-02: builtin:usage-record calls usageWindowTracker
 */
import { describe, it, expect, vi } from "vitest";
import { streamTimeoutHook } from "../../../src/proxy/hooks/builtin/stream-timeout.js";
import { usageRecordHook } from "../../../src/proxy/hooks/builtin/usage-record.js";
import type { PipelineContext, ProviderInfo } from "../../../src/proxy/pipeline/types.js";
import { ServiceContainer } from "../../../src/core/container.js";
import { SERVICE_KEYS } from "../../../src/core/container.js";
import type { ResilienceResult, TransportResult } from "../../../src/core/types.js";

function mockContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    request: { log: { debug: vi.fn(), error: vi.fn() } } as unknown as PipelineContext["request"],
    reply: {} as PipelineContext["reply"],
    rawBody: { model: "gpt-4o" },
    clientModel: "gpt-4o",
    apiType: "openai",
    body: { model: "gpt-4o" },
    isStream: true,
    resolved: null,
    provider: null,
    effectiveUpstreamPath: "",
    effectiveApiType: "openai",
    injectedHeaders: {},
    metadata: new Map(),
    logId: "test-log-id",
    rootLogId: null,
    transportResult: null,
    resilienceResult: null,
    clientRequest: "",
    upstreamRequest: "",
    snapshot: {} as PipelineContext["snapshot"],
    ...overrides,
  };
}

// ===================== TC-6-01: stream-timeout =====================

describe("builtin:stream-timeout", () => {
  it("TC-6-01: writes SSE error event on stream_abort with timeout context (openai format)", () => {
    const writeFn = vi.fn();
    const endFn = vi.fn();
    const raw = { write: writeFn, end: endFn, headersSent: true };

    const ctx = mockContext({
      apiType: "openai",
      resilienceResult: {
        result: {
          kind: "stream_abort",
          statusCode: 503,
          sentHeaders: {},
          timeoutContext: { modelId: "gpt-4o", providerId: "provider-1" },
          timeoutMs: 30000,
        },
        attempts: [],
        excludedTargets: [],
        action: "stop",
      } as ResilienceResult,
    });
    (ctx.reply as Record<string, unknown>).raw = raw;

    streamTimeoutHook.execute(ctx);

    expect(writeFn).toHaveBeenCalledTimes(1);
    const written = writeFn.mock.calls[0][0] as string;
    expect(written).toMatch(/^data: /);
    const parsed = JSON.parse(written.replace("data: ", "").replace(/\n\n$/, ""));
    expect(parsed.error.code).toBe("stream_timeout");
    expect(parsed.error.message).toContain("gpt-4o");
    expect(endFn).toHaveBeenCalledTimes(1);
  });

  it("TC-6-01: writes SSE error event with anthropic format for anthropic requests", () => {
    const writeFn = vi.fn();
    const endFn = vi.fn();
    const raw = { write: writeFn, end: endFn, headersSent: true };

    const ctx = mockContext({
      apiType: "anthropic",
      resilienceResult: {
        result: {
          kind: "stream_abort",
          statusCode: 503,
          sentHeaders: {},
          timeoutContext: { modelId: "claude-3", providerId: "provider-2" },
          timeoutMs: 15000,
        },
        attempts: [],
        excludedTargets: [],
        action: "stop",
      } as ResilienceResult,
    });
    (ctx.reply as Record<string, unknown>).raw = raw;

    streamTimeoutHook.execute(ctx);

    const written = writeFn.mock.calls[0][0] as string;
    const parsed = JSON.parse(written.replace("data: ", "").replace(/\n\n$/, ""));
    expect(parsed.type).toBe("error");
    expect(parsed.error.message).toContain("claude-3");
  });

  it("does nothing when resilience result is not stream_abort", () => {
    const writeFn = vi.fn();
    const raw = { write: writeFn, end: vi.fn(), headersSent: true };

    const ctx = mockContext({
      resilienceResult: {
        result: {
          kind: "success",
          statusCode: 200,
          body: "ok",
          headers: {},
          sentHeaders: {},
          sentBody: "ok",
        },
        attempts: [],
        excludedTargets: [],
        action: "continue",
      } as ResilienceResult,
    });
    (ctx.reply as Record<string, unknown>).raw = raw;

    streamTimeoutHook.execute(ctx);

    expect(writeFn).not.toHaveBeenCalled();
  });

  it("does nothing when resilience result is null", () => {
    const ctx = mockContext({ resilienceResult: null });
    // Should not throw
    expect(() => streamTimeoutHook.execute(ctx)).not.toThrow();
  });

  it("does nothing when stream_abort has no timeoutContext", () => {
    const writeFn = vi.fn();
    const raw = { write: writeFn, end: vi.fn(), headersSent: true };

    const ctx = mockContext({
      resilienceResult: {
        result: {
          kind: "stream_abort",
          statusCode: 503,
          sentHeaders: {},
          // timeoutContext undefined
        },
        attempts: [],
        excludedTargets: [],
        action: "stop",
      } as ResilienceResult,
    });
    (ctx.reply as Record<string, unknown>).raw = raw;

    streamTimeoutHook.execute(ctx);

    expect(writeFn).not.toHaveBeenCalled();
  });
});

// ===================== TC-6-02: usage-record =====================

describe("builtin:usage-record", () => {
  const mockProvider: ProviderInfo = {
    id: "provider-1",
    name: "Test Provider",
    base_url: "https://api.test.com",
    api_type: "openai",
    is_active: 1,
    api_key: "key",
    models: "[]",
    upstream_path: null,
    max_concurrency: 10,
    queue_timeout_ms: 30000,
    max_queue_size: 100,
    adaptive_enabled: 0,
    created_at: new Date().toISOString(),
  };

  it("TC-6-02: calls usageWindowTracker.recordRequest on success result", () => {
    const recordRequest = vi.fn();
    const tracker = { recordRequest };

    const container = new ServiceContainer();
    container.register(SERVICE_KEYS.usageWindowTracker, () => tracker);

    const ctx = mockContext({
      provider: mockProvider,
      resilienceResult: {
        result: {
          kind: "success",
          statusCode: 200,
          body: "ok",
          headers: {},
          sentHeaders: {},
          sentBody: "ok",
        },
        attempts: [],
        excludedTargets: [],
        action: "continue",
      } as ResilienceResult,
    });
    ctx.request.routerKey = { id: "key-123" } as never;
    ctx.metadata.set("container", container);

    usageRecordHook.execute(ctx);

    expect(recordRequest).toHaveBeenCalledWith("provider-1", "key-123");
  });

  it("TC-6-02: calls usageWindowTracker on stream_success result", () => {
    const recordRequest = vi.fn();
    const tracker = { recordRequest };

    const container = new ServiceContainer();
    container.register(SERVICE_KEYS.usageWindowTracker, () => tracker);

    const ctx = mockContext({
      provider: mockProvider,
      resilienceResult: {
        result: {
          kind: "stream_success",
          statusCode: 200,
          sentHeaders: {},
        },
        attempts: [],
        excludedTargets: [],
        action: "continue",
      } as ResilienceResult,
    });
    ctx.metadata.set("container", container);

    usageRecordHook.execute(ctx);

    expect(recordRequest).toHaveBeenCalledWith("provider-1", undefined);
  });

  it("TC-6-02: calls usageWindowTracker on stream_abort result", () => {
    const recordRequest = vi.fn();
    const tracker = { recordRequest };

    const container = new ServiceContainer();
    container.register(SERVICE_KEYS.usageWindowTracker, () => tracker);

    const ctx = mockContext({
      provider: mockProvider,
      resilienceResult: {
        result: {
          kind: "stream_abort",
          statusCode: 503,
          sentHeaders: {},
        },
        attempts: [],
        excludedTargets: [],
        action: "stop",
      } as ResilienceResult,
    });
    ctx.metadata.set("container", container);

    usageRecordHook.execute(ctx);

    expect(recordRequest).toHaveBeenCalledWith("provider-1", undefined);
  });

  it("does not call usageWindowTracker on error result", () => {
    const recordRequest = vi.fn();
    const tracker = { recordRequest };

    const container = new ServiceContainer();
    container.register(SERVICE_KEYS.usageWindowTracker, () => tracker);

    const ctx = mockContext({
      provider: mockProvider,
      resilienceResult: {
        result: {
          kind: "error",
          statusCode: 500,
          body: "err",
          headers: {},
          sentHeaders: {},
          sentBody: "err",
        },
        attempts: [],
        excludedTargets: [],
        action: "stop",
      } as ResilienceResult,
    });
    ctx.metadata.set("container", container);

    usageRecordHook.execute(ctx);

    expect(recordRequest).not.toHaveBeenCalled();
  });

  it("does not call usageWindowTracker when resilience result is null", () => {
    const recordRequest = vi.fn();
    const tracker = { recordRequest };

    const container = new ServiceContainer();
    container.register(SERVICE_KEYS.usageWindowTracker, () => tracker);

    const ctx = mockContext({
      provider: mockProvider,
      resilienceResult: null,
    });
    ctx.metadata.set("container", container);

    usageRecordHook.execute(ctx);

    expect(recordRequest).not.toHaveBeenCalled();
  });
});

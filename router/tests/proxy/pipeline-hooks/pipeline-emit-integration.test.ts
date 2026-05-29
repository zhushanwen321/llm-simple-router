/**
 * Pipeline emit 集成测试
 *
 * 覆盖：
 * - TC-7-01: All 6 new hooks registered in proxyPipeline
 * - TC-1-01: Pipeline emit covers all 4 core phases on successful request
 * - TC-1-02: Pipeline emit on_error on upstream failure
 * - TC-5-01: builtin:transport-execute calls orchestrator.handle
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProxyPipeline } from "../../../src/proxy/pipeline/pipeline.js";
import { PipelineAbort } from "../../../src/proxy/pipeline/types.js";
import type { PipelineContext, PipelineHook, HookPhase } from "../../../src/proxy/pipeline/types.js";
import { registerBuiltinHooks } from "../../../src/proxy/pipeline/register-hooks.js";
import { proxyPipeline } from "../../../src/proxy/pipeline/pipeline.js";
import { PipelineSnapshot } from "../../../src/proxy/pipeline-snapshot.js";
import { transportExecuteHook } from "../../../src/proxy/hooks/builtin/transport-execute.js";
import type { Target, TransportResult, ResilienceAttempt } from "../../../src/core/types.js";
import type { ResilienceResult } from "../../../src/proxy/orchestration/resilience.js";

// ---------- Helpers ----------

/** 构造最小 mock PipelineContext */
function mockContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { log: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() } } as unknown as PipelineContext["request"],
    reply: {
      raw: { write: vi.fn(), end: vi.fn() },
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    } as unknown as PipelineContext["reply"],
    rawBody: {},
    clientModel: "gpt-4o",
    apiType: "openai",
    body: { model: "gpt-4o", stream: false },
    isStream: false,
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
    snapshot: new PipelineSnapshot(),
    ...overrides,
  };
}

/** 工厂：创建追踪 hook */
function trackerHook(
  name: string,
  phase: HookPhase,
  priority: number,
  tracker: string[],
): PipelineHook {
  return {
    name,
    phase,
    priority,
    execute: () => { tracker.push(name); },
  };
}

// =====================================================================
// TC-7-01: All 6 new hooks registered in proxyPipeline
// =====================================================================
describe("TC-7-01: All 6 new hooks registered in proxyPipeline", () => {
  // 每个测试前需要重新注册（proxyPipeline 单例在测试间共享）
  let freshPipeline: ProxyPipeline;

  beforeEach(() => {
    freshPipeline = new ProxyPipeline();
    // 模拟 registerBuiltinHooks：直接注册所有 15 个 hook
    // 但这里用 import 的方式验证真实注册
  });

  it("TC-7-01: registerBuiltinHooks registers all 6 new hooks to correct phases", () => {
    registerBuiltinHooks();

    const postRoute = proxyPipeline.getHookChain("post_route");
    const preTransport = proxyPipeline.getHookChain("pre_transport");
    const postResponse = proxyPipeline.getHookChain("post_response");

    const postRouteNames = postRoute.map((h) => h.name);
    const preTransportNames = preTransport.map((h) => h.name);
    const postResponseNames = postResponse.map((h) => h.name);

    // 6 个新 hook
    expect(postRouteNames).toContain("builtin:route-resolve");
    expect(preTransportNames).toContain("builtin:format-transform");
    expect(preTransportNames).toContain("builtin:api-key-decrypt");
    expect(preTransportNames).toContain("builtin:transport-execute");
    expect(postResponseNames).toContain("builtin:stream-timeout");
    expect(postResponseNames).toContain("builtin:usage-record");
  });

  it("TC-7-01: new hooks have correct phases", () => {
    registerBuiltinHooks();

    // 深度验证：每个 hook 的 name→phase 映射正确
    const postRoute = proxyPipeline.getHookChain("post_route");
    const preTransport = proxyPipeline.getHookChain("pre_transport");
    const postResponse = proxyPipeline.getHookChain("post_response");

    // route-resolve 在 post_route
    const routeResolve = postRoute.find((h) => h.name === "builtin:route-resolve");
    expect(routeResolve).toBeDefined();

    // format-transform, api-key-decrypt, transport-execute 在 pre_transport
    const fmtTransform = preTransport.find((h) => h.name === "builtin:format-transform");
    const apiKeyDecrypt = preTransport.find((h) => h.name === "builtin:api-key-decrypt");
    const transportExec = preTransport.find((h) => h.name === "builtin:transport-execute");
    expect(fmtTransform).toBeDefined();
    expect(apiKeyDecrypt).toBeDefined();
    expect(transportExec).toBeDefined();

    // stream-timeout, usage-record 在 post_response
    const streamTimeout = postResponse.find((h) => h.name === "builtin:stream-timeout");
    const usageRecord = postResponse.find((h) => h.name === "builtin:usage-record");
    expect(streamTimeout).toBeDefined();
    expect(usageRecord).toBeDefined();
  });

  it("TC-7-01: transport-execute has core=true", () => {
    registerBuiltinHooks();

    const preTransport = proxyPipeline.getHookChain("pre_transport");
    const transportExec = preTransport.find((h) => h.name === "builtin:transport-execute");
    expect(transportExec).toBeDefined();
    expect(transportExec!.priority).toBe(300);
  });

  it("TC-7-01: all 15 hooks are registered (6 new + 9 existing)", () => {
    registerBuiltinHooks();

    const allPhases: HookPhase[] = [
      "pre_route",
      "post_route",
      "pre_transport",
      "post_response",
      "on_error",
      "on_stream_event",
    ];

    const allNames = new Set<string>();
    for (const phase of allPhases) {
      for (const hook of proxyPipeline.getHookChain(phase)) {
        allNames.add(hook.name);
      }
    }

    // 15 个内置 hook（幂等注册不重复）
    expect(allNames.size).toBe(15);
    expect(allNames).toContain("builtin:route-resolve");
    expect(allNames).toContain("builtin:format-transform");
    expect(allNames).toContain("builtin:api-key-decrypt");
    expect(allNames).toContain("builtin:transport-execute");
    expect(allNames).toContain("builtin:stream-timeout");
    expect(allNames).toContain("builtin:usage-record");
    expect(allNames).toContain("builtin:error-logging");
    expect(allNames).toContain("builtin:request-logging");
    expect(allNames).toContain("builtin:enhancement-preprocess");
    expect(allNames).toContain("builtin:allowed-models");
    expect(allNames).toContain("builtin:overflow-redirect");
    expect(allNames).toContain("builtin:plugin-request");
    expect(allNames).toContain("builtin:provider-patches");
    expect(allNames).toContain("builtin:client-detection");
    expect(allNames).toContain("builtin:cache-estimation");
  });
});

// =====================================================================
// TC-1-01: Pipeline emit covers all 4 core phases on successful request
// =====================================================================
describe("TC-1-01: Pipeline emit covers all 4 core phases on successful request", () => {
  it("TC-1-01: emit all 4 phases in sequence with hooks executing", async () => {
    const pipeline = new ProxyPipeline();
    const executed: string[] = [];
    const ctx = mockContext();

    // 为 4 个核心阶段注册追踪 hook
    pipeline.register(trackerHook("pre-route-1", "pre_route", 100, executed));
    pipeline.register(trackerHook("post-route-1", "post_route", 100, executed));
    pipeline.register(trackerHook("pre-transport-1", "pre_transport", 100, executed));
    pipeline.register(trackerHook("post-response-1", "post_response", 100, executed));

    // 模拟成功请求的 4 阶段 emit 序列
    await pipeline.emit("pre_route", ctx);
    // post_route 需要 resolved（模拟 route-resolve）
    ctx.resolved = {
      provider_id: "test-provider",
      backend_model: "gpt-4o",
    } as Target;
    await pipeline.emit("post_route", ctx);
    await pipeline.emit("pre_transport", ctx);
    await pipeline.emit("post_response", ctx);

    expect(executed).toEqual([
      "pre-route-1",
      "post-route-1",
      "pre-transport-1",
      "post-response-1",
    ]);
  });

  it("TC-1-01: hooks within a phase execute in priority order", async () => {
    const pipeline = new ProxyPipeline();
    const executed: string[] = [];
    const ctx = mockContext();

    // 在 pre_transport 阶段注册多个 hook（模拟真实的 priority 排列）
    pipeline.register(trackerHook("fmt-transform", "pre_transport", 0, executed));
    pipeline.register(trackerHook("api-key-decrypt", "pre_transport", 1, executed));
    pipeline.register(trackerHook("transport-execute", "pre_transport", 300, executed));

    await pipeline.emit("pre_transport", ctx);

    expect(executed).toEqual([
      "fmt-transform",
      "api-key-decrypt",
      "transport-execute",
    ]);
  });

  it("TC-1-01: context mutation flows across phases", async () => {
    const pipeline = new ProxyPipeline();
    const ctx = mockContext();

    // post_route hook 设置 resolved
    pipeline.register({
      name: "set-resolved",
      phase: "post_route",
      priority: 0,
      execute: (c) => {
        c.resolved = { provider_id: "p1", backend_model: "gpt-4o" } as Target;
      },
    });

    // pre_transport hook 读取 resolved
    let capturedProviderId: string | null = null;
    pipeline.register({
      name: "read-resolved",
      phase: "pre_transport",
      priority: 100,
      execute: (c) => {
        capturedProviderId = c.resolved?.provider_id ?? null;
      },
    });

    await pipeline.emit("post_route", ctx);
    await pipeline.emit("pre_transport", ctx);

    expect(capturedProviderId).toBe("p1");
  });
});

// =====================================================================
// TC-1-02: Pipeline emit on_error on upstream failure
// =====================================================================
describe("TC-1-02: Pipeline emit on_error on upstream failure", () => {
  it("TC-1-02: on_error phase hooks execute when error occurs", async () => {
    const pipeline = new ProxyPipeline();
    const executed: string[] = [];
    const ctx = mockContext();

    pipeline.register(trackerHook("error-handler", "on_error", 100, executed));
    pipeline.register(trackerHook("error-logger", "on_error", 200, executed));

    await pipeline.emit("on_error", ctx);

    expect(executed).toEqual(["error-handler", "error-logger"]);
  });

  it("TC-1-02: on_error receives error info from context metadata", async () => {
    const pipeline = new ProxyPipeline();
    const ctx = mockContext();

    ctx.metadata.set("errorInfo", {
      statusCode: 502,
      errorMessage: "Upstream connection refused",
      providerId: "test-provider",
    });

    let capturedErrorInfo: unknown = null;
    pipeline.register({
      name: "capture-error",
      phase: "on_error",
      priority: 100,
      execute: (c) => {
        capturedErrorInfo = c.metadata.get("errorInfo");
      },
    });

    await pipeline.emit("on_error", ctx);

    expect(capturedErrorInfo).toEqual({
      statusCode: 502,
      errorMessage: "Upstream connection refused",
      providerId: "test-provider",
    });
  });

  it("TC-1-02: pre_route hook throwing PipelineAbort triggers on_error", async () => {
    const pipeline = new ProxyPipeline();
    const executed: string[] = [];
    const ctx = mockContext();

    // pre_route hook 抛出 abort
    pipeline.register({
      name: "aborter",
      phase: "pre_route",
      priority: 100,
      execute: () => {
        throw new PipelineAbort(429, { error: { message: "Rate limited", type: "server_error" } });
      },
    });

    // on_error hook
    pipeline.register(trackerHook("error-handler", "on_error", 100, executed));

    // 模拟 pipeline 调用模式：pre_route 失败 → on_error
    try {
      await pipeline.emit("pre_route", ctx);
    } catch (e) {
      // pre_route 中 PipelineAbort 被抛出
      // 实际场景中调用者捕获后 emit("on_error", ctx)
      expect(e).toBeInstanceOf(PipelineAbort);
      const abort = e as PipelineAbort;
      ctx.metadata.set("errorInfo", {
        statusCode: abort.statusCode,
        errorMessage: JSON.stringify(abort.body),
      });
      await pipeline.emit("on_error", ctx);
    }

    expect(executed).toContain("error-handler");
  });

  it("TC-1-02: non-core on_error hook failure degrades gracefully", async () => {
    const pipeline = new ProxyPipeline();
    const executed: string[] = [];
    const ctx = mockContext();

    // 第一个 on_error hook 失败（priority=200，非核心）
    pipeline.register({
      name: "failing-error-handler",
      phase: "on_error",
      priority: 200,
      execute: () => {
        throw new Error("error handler crashed");
      },
    });

    // 第二个 on_error hook 应继续执行
    pipeline.register(trackerHook("fallback-logger", "on_error", 300, executed));

    await pipeline.emit("on_error", ctx);

    expect(executed).toContain("fallback-logger");
    // 降级日志已记录
    expect(ctx.request.log.error).toHaveBeenCalled();
  });
});

// =====================================================================
// TC-5-01: builtin:transport-execute calls orchestrator.handle
// =====================================================================
describe("TC-5-01: builtin:transport-execute calls orchestrator.handle", () => {
  it("TC-5-01: transport-execute sets ctx.transportResult via mock orchestrator", async () => {
    const ctx = mockContext();
    ctx.resolved = {
      provider_id: "test-provider",
      backend_model: "gpt-4o",
    } as Target;
    ctx.provider = {
      id: "test-provider",
      name: "Test Provider",
      base_url: "https://api.example.com",
      api_type: "openai",
      is_active: 1,
      api_key: "encrypted-key",
      models: '[]',
      upstream_path: null,
      max_concurrency: 10,
      queue_timeout_ms: 30000,
      max_queue_size: 100,
      adaptive_enabled: 0,
      created_at: new Date().toISOString(),
    };
    ctx.effectiveApiType = "openai";
    ctx.effectiveUpstreamPath = "/v1/chat/completions";

    const mockResult: TransportResult = {
      kind: "success",
      statusCode: 200,
      body: '{"choices":[]}',
      headers: {},
      sentHeaders: {},
      sentBody: "",
    };
    const mockResilienceResult: ResilienceResult = {
      result: mockResult,
      attempts: [],
      excludedTargets: [],
      action: "continue",
    };

    const mockOrchestrator = {
      handle: vi.fn().mockResolvedValue(mockResilienceResult),
    };

    const mockFormatRegistry = {
      createStreamTransform: vi.fn().mockReturnValue(undefined),
      needsTransform: vi.fn().mockReturnValue(false),
    };

    const mockContainer = {
      resolve: vi.fn((key: string) => {
        if (key === "formatRegistry") return mockFormatRegistry;
        if (key === "proxyAgentFactory") return undefined;
        if (key === "pluginRegistry") return null;
        return undefined;
      }),
    };

    const mockMatcher = { load: vi.fn() };

    ctx.deps = {
      setup: {
        container: mockContainer as never,
        orchestrator: mockOrchestrator as never,
        tracker: undefined as never,
        matcher: mockMatcher as never,
        errors: undefined as never,
        logFileWriter: undefined as never,
        usageWindowTracker: undefined as never,
        proxyAgentFactory: undefined as never,
        db: undefined as never,
        retryBaseDelayMs: 1000,
      },
      request: {
        adapter: { beforeSendProxy: vi.fn() } as never,
        clientHeaders: {},
        precomputedClientReq: "{}",
        retryBaseDelayMs: 1000,
        enhancementConfig: { stream_loop_enabled: false } as { tool_call_loop_enabled: boolean; stream_loop_enabled: boolean; tool_round_limit_enabled: boolean; tool_error_logging_enabled: boolean },
        cachedTargets: [ctx.resolved] as never,
        concurrencyOverride: undefined as never,
        defaultUpstreamPath: undefined as never,
        decryptedApiKeys: undefined as never,
        precomputeSnapshot: undefined as never,
        resolveResult: undefined as never,
        overflowIndices: undefined as never,
      },
    };
    ctx.iterationStartTime = Date.now();
    ctx.metadata.set("apiKey", "sk-test-key");
    ctx.metadata.set("needsTransform", false);

    // 执行 transport-execute hook
    await transportExecuteHook.execute(ctx);

    // 验证 orchestrator.handle 被调用
    expect(mockOrchestrator.handle).toHaveBeenCalledOnce();

    // 验证 ctx.transportResult 被设置
    expect(ctx.transportResult).toBe(mockResult);
    expect(ctx.transportResult!.kind).toBe("success");
    expect(ctx.transportResult!.statusCode).toBe(200);

    // 验证 ctx.resilienceResult 被设置
    expect(ctx.resilienceResult).toBe(mockResilienceResult);

    // 验证 adapter.beforeSendProxy 被调用
    expect(ctx.deps!.request.adapter.beforeSendProxy).toHaveBeenCalled();
  });

  it("TC-5-01: transport-execute propagates orchestrator errors", async () => {
    const ctx = mockContext();
    ctx.resolved = { provider_id: "p1", backend_model: "gpt-4o" } as Target;
    ctx.provider = {
      id: "p1",
      name: "P1",
      base_url: "https://api.example.com",
      api_type: "openai",
      is_active: 1,
      api_key: "enc",
      models: "[]",
      upstream_path: null,
      max_concurrency: 10,
      queue_timeout_ms: 30000,
      max_queue_size: 100,
      adaptive_enabled: 0,
      created_at: new Date().toISOString(),
    };
    ctx.effectiveApiType = "openai";
    ctx.effectiveUpstreamPath = "/v1/chat/completions";

    const mockOrchestrator = {
      handle: vi.fn().mockRejectedValue(new Error("Connection refused")),
    };
    const mockFormatRegistry = {
      createStreamTransform: vi.fn().mockReturnValue(undefined),
      needsTransform: vi.fn().mockReturnValue(false),
    };
    const mockContainer = {
      resolve: vi.fn((key: string) => {
        if (key === "formatRegistry") return mockFormatRegistry;
        if (key === "proxyAgentFactory") return undefined;
        if (key === "pluginRegistry") return null;
        return undefined;
      }),
    };

    ctx.deps = {
      setup: {
        container: mockContainer as never,
        orchestrator: mockOrchestrator as never,
        tracker: undefined as never,
        matcher: { load: vi.fn() } as never,
        errors: undefined as never,
        logFileWriter: undefined as never,
        usageWindowTracker: undefined as never,
        proxyAgentFactory: undefined as never,
        db: undefined as never,
        retryBaseDelayMs: 1000,
      },
      request: {
        adapter: { beforeSendProxy: vi.fn() } as never,
        clientHeaders: {},
        precomputedClientReq: "{}",
        enhancementConfig: { stream_loop_enabled: false } as { tool_call_loop_enabled: boolean; stream_loop_enabled: boolean; tool_round_limit_enabled: boolean; tool_error_logging_enabled: boolean },
        cachedTargets: [ctx.resolved] as never,
        concurrencyOverride: undefined as never,
        defaultUpstreamPath: undefined as never,
        decryptedApiKeys: undefined as never,
        precomputeSnapshot: undefined as never,
        resolveResult: undefined as never,
        overflowIndices: undefined as never,
      },
    };
    ctx.iterationStartTime = Date.now();
    ctx.metadata.set("apiKey", "sk-test");
    ctx.metadata.set("needsTransform", false);

    // transport-execute 是 core hook，异常应传播
    await expect(transportExecuteHook.execute(ctx)).rejects.toThrow("Connection refused");

    // transportResult 不应被设置
    expect(ctx.transportResult).toBeNull();
  });

  it("TC-5-01: transport-execute passes correct parameters to orchestrator.handle", async () => {
    const ctx = mockContext();
    const resolved: Target = { provider_id: "p1", backend_model: "gpt-4o" };
    ctx.resolved = resolved;
    ctx.provider = {
      id: "p1",
      name: "P1",
      base_url: "https://api.example.com",
      api_type: "openai",
      is_active: 1,
      api_key: "enc",
      models: "[]",
      upstream_path: null,
      max_concurrency: 10,
      queue_timeout_ms: 30000,
      max_queue_size: 100,
      adaptive_enabled: 0,
      created_at: new Date().toISOString(),
    };
    ctx.effectiveApiType = "openai";
    ctx.effectiveUpstreamPath = "/v1/chat/completions";

    const mockResult: TransportResult = {
      kind: "success",
      statusCode: 200,
      body: "{}",
      headers: {},
      sentHeaders: {},
      sentBody: "",
    };

    let capturedArgs: unknown = null;
    const mockOrchestrator = {
      handle: vi.fn().mockImplementation(async (...args: unknown[]) => {
        capturedArgs = args;
        return { result: mockResult, attempts: [], excludedTargets: [] };
      }),
    };
    const mockFormatRegistry = {
      createStreamTransform: vi.fn().mockReturnValue(undefined),
      needsTransform: vi.fn().mockReturnValue(false),
    };
    const mockContainer = {
      resolve: vi.fn((key: string) => {
        if (key === "formatRegistry") return mockFormatRegistry;
        if (key === "proxyAgentFactory") return undefined;
        if (key === "pluginRegistry") return null;
        return undefined;
      }),
    };

    ctx.deps = {
      setup: {
        container: mockContainer as never,
        orchestrator: mockOrchestrator as never,
        tracker: undefined as never,
        matcher: { load: vi.fn() } as never,
        errors: undefined as never,
        logFileWriter: undefined as never,
        usageWindowTracker: undefined as never,
        proxyAgentFactory: undefined as never,
        db: undefined as never,
        retryBaseDelayMs: 1000,
      },
      request: {
        adapter: { beforeSendProxy: vi.fn() } as never,
        clientHeaders: {},
        precomputedClientReq: "{}",
        enhancementConfig: { stream_loop_enabled: false } as { tool_call_loop_enabled: boolean; stream_loop_enabled: boolean; tool_round_limit_enabled: boolean; tool_error_logging_enabled: boolean },
        cachedTargets: [resolved] as never,
        concurrencyOverride: undefined as never,
        defaultUpstreamPath: undefined as never,
        decryptedApiKeys: undefined as never,
        precomputeSnapshot: undefined as never,
        resolveResult: undefined as never,
        overflowIndices: undefined as never,
      },
    };
    ctx.iterationStartTime = Date.now();
    ctx.metadata.set("apiKey", "sk-test");
    ctx.metadata.set("needsTransform", false);

    await transportExecuteHook.execute(ctx);

    // 验证 orchestrator.handle 被调用，参数包含 request, reply, apiType, ...
    expect(mockOrchestrator.handle).toHaveBeenCalledOnce();
    const callArgs = mockOrchestrator.handle.mock.calls[0];
    // 第一个参数是 request
    expect(callArgs[0]).toBe(ctx.request);
    // 第二个参数是 reply
    expect(callArgs[1]).toBe(ctx.reply);
    // 第三个参数是 clientApiType
    expect(callArgs[2]).toBe("openai");
    // 第四个参数包含 resolved target
    const handleOpts = callArgs[3] as Record<string, unknown>;
    expect(handleOpts.resolved).toBe(resolved);
    expect(handleOpts.clientModel).toBe("gpt-4o");
  });
});

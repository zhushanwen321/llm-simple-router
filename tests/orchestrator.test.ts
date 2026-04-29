import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProxyOrchestrator } from "../src/proxy/orchestration/orchestrator.js";
import type { TransportResult } from "../src/proxy/types.js";
import type { ResilienceResult } from "../src/proxy/orchestration/resilience.js";
import type { SemaphoreScope } from "../src/proxy/orchestration/scope.js";
import type { TrackerScope } from "../src/proxy/orchestration/scope.js";
import { ProviderSwitchNeeded } from "../src/proxy/types.js";

function createMockDeps() {
  return {
    semaphoreScope: { withSlot: vi.fn() } as unknown as SemaphoreScope,
    trackerScope: { track: vi.fn() } as unknown as TrackerScope,
    resilience: { execute: vi.fn() },
  };
}

const successResult: TransportResult = {
  kind: "success", statusCode: 200,
  body: JSON.stringify({ choices: [{ message: { content: "hi" } }] }),
  headers: { "content-type": "application/json" },
  sentHeaders: {}, sentBody: "",
};

function createMockRequest(overrides = {}) {
  return {
    body: { model: "gpt-4", stream: false },
    headers: { "content-type": "application/json" },
    log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    raw: { socket: { on: vi.fn() }, on: vi.fn() },
    routerKey: null, ip: "127.0.0.1",
    ...overrides,
  } as any;
}

function createMockReply() {
  return {
    code: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    raw: { headersSent: false, writableEnded: false, writableFinished: false, on: vi.fn(), writeHead: vi.fn(), end: vi.fn(), write: vi.fn() },
  } as any;
}

const defaultConfig = {
  resolved: { backend_model: "gpt-4", provider_id: "p1" },
  provider: { id: "p1", name: "test", is_active: 1, api_type: "openai", base_url: "http://localhost:8080", api_key: "enc:xxx" },
  clientModel: "gpt-4",
  isStream: false,
};

function successResilienceResult(overrides: Partial<ResilienceResult> = {}): ResilienceResult {
  return {
    result: successResult,
    attempts: [{ target: { backend_model: "gpt-4", provider_id: "p1" }, attemptIndex: 0, statusCode: 200, error: null, latencyMs: 50, responseBody: null }],
    excludedTargets: [],
    ...overrides,
  };
}

function setupMocks(deps: ReturnType<typeof createMockDeps>) {
  deps.semaphoreScope.withSlot = vi.fn((_p: any, _s: any, _q: any, fn: any) => fn());
  deps.trackerScope.track = vi.fn((_req: any, fn: any) => fn());
}

describe("ProxyOrchestrator", () => {
  let deps: ReturnType<typeof createMockDeps>;
  let orchestrator: ProxyOrchestrator;
  beforeEach(() => { deps = createMockDeps(); orchestrator = new ProxyOrchestrator(deps as any); });

  it("正常非流式请求返回 ResilienceResult 并发送 200 响应", async () => {
    setupMocks(deps);
    deps.resilience.execute = vi.fn(() => Promise.resolve(successResilienceResult()));
    const reply = createMockReply();
    const result = await orchestrator.handle(
      createMockRequest(), reply, "openai", defaultConfig, { transportFn: vi.fn() },
    );
    expect(result).toEqual(successResilienceResult());
    expect(deps.semaphoreScope.withSlot).toHaveBeenCalledWith("p1", expect.anything(), expect.any(Function), expect.any(Function), undefined);
    expect(deps.resilience.execute).toHaveBeenCalled();
    expect(reply.code).toHaveBeenCalledWith(200);
  });

  it("stream_success 不调用 reply.code/send", async () => {
    setupMocks(deps);
    const streamResult: TransportResult = { kind: "stream_success", statusCode: 200, sentHeaders: {} };
    deps.resilience.execute = vi.fn(() => Promise.resolve(successResilienceResult({ result: streamResult })));
    const reply = createMockReply();
    await orchestrator.handle(
      createMockRequest({ body: { model: "gpt-4", stream: true } }), reply, "openai",
      { ...defaultConfig, isStream: true }, { transportFn: vi.fn() },
    );
    expect(reply.code).not.toHaveBeenCalled();
  });

  it("stream_abort 不调用 reply.code/send", async () => {
    setupMocks(deps);
    const abortResult: TransportResult = { kind: "stream_abort", statusCode: 200, sentHeaders: {} };
    deps.resilience.execute = vi.fn(() => Promise.resolve(successResilienceResult({ result: abortResult })));
    const reply = createMockReply();
    await orchestrator.handle(createMockRequest(), reply, "openai", defaultConfig, { transportFn: vi.fn() });
    expect(reply.code).not.toHaveBeenCalled();
  });

  it("throw kind 不调用 reply.code/send", async () => {
    setupMocks(deps);
    const throwResult: TransportResult = { kind: "throw", error: new Error("connection failed") };
    deps.resilience.execute = vi.fn(() => Promise.resolve(successResilienceResult({ result: throwResult })));
    const reply = createMockReply();
    await orchestrator.handle(createMockRequest(), reply, "openai", defaultConfig, { transportFn: vi.fn() });
    expect(reply.code).not.toHaveBeenCalled();
  });

  it("stream_error 时发送错误响应", async () => {
    setupMocks(deps);
    const errResult: TransportResult = { kind: "stream_error", statusCode: 429, body: "rate limited", headers: { "content-type": "text/plain" }, sentHeaders: {} };
    deps.resilience.execute = vi.fn(() => Promise.resolve(successResilienceResult({ result: errResult })));
    const reply = createMockReply();
    await orchestrator.handle(createMockRequest(), reply, "openai", defaultConfig, { transportFn: vi.fn() });
    expect(reply.code).toHaveBeenCalledWith(429);
    expect(reply.send).toHaveBeenCalledWith("rate limited");
  });

  it("error kind 时发送错误响应", async () => {
    setupMocks(deps);
    const errResult: TransportResult = { kind: "error", statusCode: 500, body: "internal error", headers: {}, sentHeaders: {}, sentBody: "" };
    deps.resilience.execute = vi.fn(() => Promise.resolve(successResilienceResult({ result: errResult })));
    const reply = createMockReply();
    await orchestrator.handle(createMockRequest(), reply, "openai", defaultConfig, { transportFn: vi.fn() });
    expect(reply.code).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith("internal error");
  });

  it("通过 withSlot 传递 onQueued 回调", async () => {
    let capturedOnQueued: (() => void) | undefined;
    deps.semaphoreScope.withSlot = vi.fn((_p: any, _s: any, onQueued: any, fn: any) => { capturedOnQueued = onQueued; return fn(); });
    deps.trackerScope.track = vi.fn((_req: any, fn: any) => fn());
    deps.resilience.execute = vi.fn(() => Promise.resolve(successResilienceResult()));
    await orchestrator.handle(createMockRequest(), createMockReply(), "openai", defaultConfig, { transportFn: vi.fn() });
    expect(capturedOnQueued).toBeDefined();
  });

  it("传递 resilienceConfig 从 HandleContext", async () => {
    setupMocks(deps);
    deps.resilience.execute = vi.fn(() => Promise.resolve(successResilienceResult()));
    await orchestrator.handle(
      createMockRequest(), createMockReply(), "openai", defaultConfig,
      { transportFn: vi.fn(), retryBaseDelayMs: 2000, failoverThreshold: 500, isFailover: true },
    );
    expect(deps.resilience.execute).toHaveBeenCalledWith(
      expect.any(Function), expect.any(Function),
      { baseDelayMs: 2000, failoverThreshold: 500, isFailover: true },
    );
  });

  it("ProviderSwitchNeeded 异常冒泡到调用方", async () => {
    setupMocks(deps);
    deps.resilience.execute = vi.fn(() => Promise.reject(new ProviderSwitchNeeded("p2")));
    await expect(
      orchestrator.handle(createMockRequest(), createMockReply(), "openai", defaultConfig, { transportFn: vi.fn() }),
    ).rejects.toThrow("Provider switch needed: p2");
  });

  it("ctx 未提供时抛出明确错误", async () => {
    setupMocks(deps);
    await expect(
      orchestrator.handle(createMockRequest(), createMockReply(), "openai", defaultConfig),
    ).rejects.toThrow("HandleContext.transportFn is required");
  });

  it("使用 config.clientModel 而非 request.body", async () => {
    let capturedReq: any;
    deps.trackerScope.track = vi.fn((req: any, fn: any) => { capturedReq = req; return fn(); });
    deps.semaphoreScope.withSlot = vi.fn((_p: any, _s: any, _q: any, fn: any) => fn());
    deps.resilience.execute = vi.fn(() => Promise.resolve(successResilienceResult()));
    await orchestrator.handle(
      createMockRequest(), createMockReply(), "openai",
      { ...defaultConfig, clientModel: "custom-model" }, { transportFn: vi.fn() },
    );
    expect(capturedReq.model).toBe("custom-model");
  });
});

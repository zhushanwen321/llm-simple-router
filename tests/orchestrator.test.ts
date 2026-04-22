import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProxyOrchestrator } from "../src/proxy/orchestrator.js";
import type { TransportResult } from "../src/proxy/types.js";
import type { ResilienceResult } from "../src/proxy/resilience.js";
import type { SemaphoreScope } from "../src/proxy/scope.js";
import type { TrackerScope } from "../src/proxy/scope.js";
import type { ProxyErrorFormatter } from "../src/proxy/proxy-core.js";
import type { Target } from "../src/proxy/strategy/types.js";

// ---------- Mock 工厂 ----------

function createMockDeps() {
  return {
    semaphoreScope: {
      withSlot: vi.fn(),
    } as unknown as SemaphoreScope,
    trackerScope: {
      track: vi.fn(),
    } as unknown as TrackerScope,
    resilience: {
      execute: vi.fn(),
    },
  };
}

const successResult: TransportResult = {
  kind: "success", statusCode: 200,
  body: JSON.stringify({ choices: [{ message: { content: "hi" } }] }),
  headers: { "content-type": "application/json" },
  sentHeaders: {}, sentBody: "",
};

const errors: ProxyErrorFormatter = {
  modelNotFound: (model) => ({ statusCode: 404, body: { error: { message: `Model '${model}' not found` } } }),
  modelNotAllowed: (model) => ({ statusCode: 403, body: { error: { message: `Model '${model}' not allowed` } } }),
  providerUnavailable: () => ({ statusCode: 503, body: { error: { message: "Provider unavailable" } } }),
  providerTypeMismatch: () => ({ statusCode: 500, body: { error: { message: "Type mismatch" } } }),
  upstreamConnectionFailed: () => ({ statusCode: 502, body: { error: { message: "Upstream failed" } } }),
  concurrencyQueueFull: (id) => ({ statusCode: 503, body: { error: { message: `Queue full: ${id}` } } }),
  concurrencyTimeout: (id, ms) => ({ statusCode: 504, body: { error: { message: `Timeout: ${id} ${ms}ms` } } }),
};

function createMockRequest(overrides = {}) {
  return {
    body: { model: "gpt-4", stream: false },
    headers: { "content-type": "application/json" },
    log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    raw: { socket: { on: vi.fn() }, on: vi.fn() },
    routerKey: null,
    ip: "127.0.0.1",
    ...overrides,
  } as any;
}

function createMockReply() {
  const raw = { headersSent: false, writableEnded: false, writableFinished: false, on: vi.fn(), writeHead: vi.fn(), end: vi.fn(), write: vi.fn() };
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    raw,
  } as any;
}

describe("ProxyOrchestrator", () => {
  let deps: ReturnType<typeof createMockDeps>;
  let orchestrator: ProxyOrchestrator;

  beforeEach(() => {
    deps = createMockDeps();
    orchestrator = new ProxyOrchestrator(deps as any);
  });

  // --- 场景 1: 映射找不到 → 404 ---

  it("映射找不到时返回 404", async () => {
    const request = createMockRequest();
    const reply = createMockReply();

    await orchestrator.handle(
      request, reply, "openai", "/v1/chat/completions", errors,
      { resolved: null, provider: null, isStream: false },
    );

    expect(deps.semaphoreScope.withSlot).not.toHaveBeenCalled();
    expect(deps.trackerScope.track).not.toHaveBeenCalled();
    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalled();
  });

  // --- 场景 2: Provider 不可用 → 503 ---

  it("Provider 不可用时返回 503", async () => {
    const request = createMockRequest();
    const reply = createMockReply();

    await orchestrator.handle(
      request, reply, "openai", "/v1/chat/completions", errors,
      { resolved: { backend_model: "gpt-4", provider_id: "p1" }, provider: { id: "p1", name: "test", is_active: false, api_type: "openai", base_url: "http://localhost:8080", api_key: "enc:xxx" }, isStream: false },
    );

    expect(deps.semaphoreScope.withSlot).not.toHaveBeenCalled();
    expect(reply.status).toHaveBeenCalledWith(503);
  });

  // --- 场景 3: 正常非流式请求成功 ---

  it("正常非流式请求返回 200 响应", async () => {
    const request = createMockRequest();
    const reply = createMockReply();

    deps.semaphoreScope.withSlot = vi.fn((_providerId, _signal, _onQueued, fn) => fn());
    deps.trackerScope.track = vi.fn((_req, fn, _extractStatus) => fn());

    const resilienceResult: ResilienceResult = {
      result: successResult,
      attempts: [{ target: { backend_model: "gpt-4", provider_id: "p1" }, attemptIndex: 0, statusCode: 200, error: null, latencyMs: 50, responseBody: null }],
      excludedTargets: [],
    };
    deps.resilience.execute = vi.fn(() => Promise.resolve(resilienceResult));

    await orchestrator.handle(
      request, reply, "openai", "/v1/chat/completions", errors,
      { resolved: { backend_model: "gpt-4", provider_id: "p1" }, provider: { id: "p1", name: "test", is_active: true, api_type: "openai", base_url: "http://localhost:8080", api_key: "enc:xxx" }, isStream: false },
    );

    expect(deps.semaphoreScope.withSlot).toHaveBeenCalled();
    expect(deps.resilience.execute).toHaveBeenCalled();
    expect(reply.status).toHaveBeenCalledWith(200);
  });

  // --- 场景 4: 正常流式请求成功 ---

  it("正常流式请求处理 stream_success 结果", async () => {
    const request = createMockRequest({ body: { model: "gpt-4", stream: true } });
    const reply = createMockReply();

    deps.semaphoreScope.withSlot = vi.fn((_providerId, _signal, _onQueued, fn) => fn());
    deps.trackerScope.track = vi.fn((_req, fn, _extractStatus) => fn());

    const streamResult: TransportResult = {
      kind: "stream_success", statusCode: 200, sentHeaders: {},
    };
    const resilienceResult: ResilienceResult = {
      result: streamResult,
      attempts: [{ target: { backend_model: "gpt-4", provider_id: "p1" }, attemptIndex: 0, statusCode: 200, error: null, latencyMs: 100, responseBody: null }],
      excludedTargets: [],
    };
    deps.resilience.execute = vi.fn(() => Promise.resolve(resilienceResult));

    await orchestrator.handle(
      request, reply, "openai", "/v1/chat/completions", errors,
      { resolved: { backend_model: "gpt-4", provider_id: "p1" }, provider: { id: "p1", name: "test", is_active: true, api_type: "openai", base_url: "http://localhost:8080", api_key: "enc:xxx" }, isStream: true },
    );

    expect(deps.resilience.execute).toHaveBeenCalled();
  });

  // --- 场景 5: 重试 ---

  it("重试场景下 ResilienceLayer 返回多次尝试记录", async () => {
    const request = createMockRequest();
    const reply = createMockReply();

    deps.semaphoreScope.withSlot = vi.fn((_providerId, _signal, _onQueued, fn) => fn());
    deps.trackerScope.track = vi.fn((_req, fn, _extractStatus) => fn());

    const resilienceResult: ResilienceResult = {
      result: successResult,
      attempts: [
        { target: { backend_model: "gpt-4", provider_id: "p1" }, attemptIndex: 0, statusCode: 429, error: null, latencyMs: 100, responseBody: "rate limited" },
        { target: { backend_model: "gpt-4", provider_id: "p1" }, attemptIndex: 1, statusCode: 200, error: null, latencyMs: 50, responseBody: null },
      ],
      excludedTargets: [],
    };
    deps.resilience.execute = vi.fn(() => Promise.resolve(resilienceResult));

    await orchestrator.handle(
      request, reply, "openai", "/v1/chat/completions", errors,
      { resolved: { backend_model: "gpt-4", provider_id: "p1" }, provider: { id: "p1", name: "test", is_active: true, api_type: "openai", base_url: "http://localhost:8080", api_key: "enc:xxx" }, isStream: false },
    );

    expect(deps.resilience.execute).toHaveBeenCalledTimes(1);
    const result = await (deps.resilience.execute as vi.Mock).mock.results[0].value;
    expect(result.attempts).toHaveLength(2);
  });

  // --- 场景 6: Failover ---

  it("Failover 场景下 ResilienceLayer 排除失败 target 并切换", async () => {
    const request = createMockRequest();
    const reply = createMockReply();

    deps.semaphoreScope.withSlot = vi.fn((_providerId, _signal, _onQueued, fn) => fn());
    deps.trackerScope.track = vi.fn((_req, fn, _extractStatus) => fn());

    const target1: Target = { backend_model: "gpt-4", provider_id: "p1" };
    const target2: Target = { backend_model: "gpt-4o", provider_id: "p2" };

    const resilienceResult: ResilienceResult = {
      result: successResult,
      attempts: [
        { target: target1, attemptIndex: 0, statusCode: 500, error: null, latencyMs: 50, responseBody: "error" },
        { target: target2, attemptIndex: 1, statusCode: 200, error: null, latencyMs: 80, responseBody: null },
      ],
      excludedTargets: [target1],
    };
    deps.resilience.execute = vi.fn(() => Promise.resolve(resilienceResult));

    await orchestrator.handle(
      request, reply, "openai", "/v1/chat/completions", errors,
      { resolved: target1, provider: { id: "p1", name: "test", is_active: true, api_type: "openai", base_url: "http://localhost:8080", api_key: "enc:xxx" }, isStream: false },
    );

    expect(deps.resilience.execute).toHaveBeenCalledTimes(1);
    const result = await (deps.resilience.execute as vi.Mock).mock.results[0].value;
    expect(result.excludedTargets).toContainEqual(target1);
    expect(result.attempts).toHaveLength(2);
    expect(reply.status).toHaveBeenCalledWith(200);
  });

  // --- 场景 7: stream_error 响应 ---

  it("stream_error 时发送错误响应", async () => {
    const request = createMockRequest({ body: { model: "gpt-4", stream: true } });
    const reply = createMockReply();

    deps.semaphoreScope.withSlot = vi.fn((_providerId, _signal, _onQueued, fn) => fn());
    deps.trackerScope.track = vi.fn((_req, fn, _extractStatus) => fn());

    const streamErrorResult: TransportResult = {
      kind: "stream_error", statusCode: 429, body: "rate limited",
      headers: { "content-type": "text/plain" }, sentHeaders: {},
    };
    const resilienceResult: ResilienceResult = {
      result: streamErrorResult,
      attempts: [{ target: { backend_model: "gpt-4", provider_id: "p1" }, attemptIndex: 0, statusCode: 429, error: null, latencyMs: 50, responseBody: "rate limited" }],
      excludedTargets: [],
    };
    deps.resilience.execute = vi.fn(() => Promise.resolve(resilienceResult));

    await orchestrator.handle(
      request, reply, "openai", "/v1/chat/completions", errors,
      { resolved: { backend_model: "gpt-4", provider_id: "p1" }, provider: { id: "p1", name: "test", is_active: true, api_type: "openai", base_url: "http://localhost:8080", api_key: "enc:xxx" }, isStream: true },
    );

    expect(reply.status).toHaveBeenCalledWith(429);
    expect(reply.send).toHaveBeenCalledWith("rate limited");
  });

  // --- 场景 8: 信号量排队 onQueued 回调 ---

  it("信号量排队时通过 withSlot 传递 onQueued 回调并更新 trackerReq", async () => {
    const request = createMockRequest();
    const reply = createMockReply();

    let capturedOnQueued: (() => void) | undefined;
    deps.semaphoreScope.withSlot = vi.fn((_providerId, _signal, onQueued, fn) => {
      capturedOnQueued = onQueued;
      return fn();
    });
    deps.trackerScope.track = vi.fn((_req, fn, _extractStatus) => fn());

    const resilienceResult: ResilienceResult = {
      result: successResult,
      attempts: [{ target: { backend_model: "gpt-4", provider_id: "p1" }, attemptIndex: 0, statusCode: 200, error: null, latencyMs: 50, responseBody: null }],
      excludedTargets: [],
    };
    deps.resilience.execute = vi.fn(() => Promise.resolve(resilienceResult));

    await orchestrator.handle(
      request, reply, "openai", "/v1/chat/completions", errors,
      { resolved: { backend_model: "gpt-4", provider_id: "p1" }, provider: { id: "p1", name: "test", is_active: true, api_type: "openai", base_url: "http://localhost:8080", api_key: "enc:xxx" }, isStream: false },
    );

    expect(deps.semaphoreScope.withSlot).toHaveBeenCalledWith("p1", expect.anything(), expect.any(Function), expect.any(Function));
    expect(capturedOnQueued).toBeDefined();
  });
});

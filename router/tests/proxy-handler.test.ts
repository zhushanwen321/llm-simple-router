import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleProxyRequest } from "../src/proxy/handler/proxy-handler.js";
import type { ProxyErrorFormatter } from "../src/proxy/proxy-core.js";
import type { ResilienceResult } from "../src/proxy/orchestration/resilience.js";
import { ProviderSwitchNeeded } from "../src/proxy/types.js";
import { SemaphoreQueueFullError, SemaphoreTimeoutError } from "@llm-router/core";

vi.mock("../src/db/index.js", () => ({
  getMappingGroup: vi.fn(() => undefined),
  getProviderById: vi.fn(() => null),
  insertRequestLog: vi.fn(),
  seedDefaultRules: vi.fn(),
}));

vi.mock("../src/utils/crypto.js", () => ({ decrypt: vi.fn(() => "sk-test") }));
vi.mock("../src/db/settings.js", () => ({ getSetting: vi.fn(() => "enc-key") }));
vi.mock("../src/proxy/routing/mapping-resolver.js", () => ({
  resolveMapping: vi.fn(() => null),
}));
vi.mock("../src/proxy/proxy-logging.js", () => ({
  logResilienceResult: vi.fn(),
  collectTransportMetrics: vi.fn(),
  sanitizeHeadersForLog: vi.fn((h) => h),
}));
vi.mock("../src/proxy/log-helpers.js", () => ({ insertRejectedLog: vi.fn() }));
vi.mock("../src/proxy/transport/http.js", () => ({
  callNonStream: vi.fn(),
  callStream: vi.fn(),
}));

import { getProviderById } from "../src/db/index.js";
import { resolveMapping } from "../src/proxy/routing/mapping-resolver.js";
import { logResilienceResult, collectTransportMetrics } from "../src/proxy/proxy-logging.js";
import { insertRejectedLog } from "../src/proxy/log-helpers.js";
import { ServiceContainer, SERVICE_KEYS } from "../src/core/container.js";
import { ProxyAgentFactory } from "../src/proxy/transport/proxy-agent.js";


const errors: ProxyErrorFormatter = {
  modelNotFound: (m) => ({ statusCode: 404, body: { error: { message: `Model '${m}' not found` } } }),
  modelNotAllowed: (m) => ({ statusCode: 403, body: { error: { message: `Model '${m}' not allowed` } } }),
  providerUnavailable: () => ({ statusCode: 503, body: { error: { message: "Provider unavailable" } } }),
  providerTypeMismatch: () => ({ statusCode: 500, body: { error: { message: "Type mismatch" } } }),
  upstreamConnectionFailed: () => ({ statusCode: 502, body: { error: { message: "Upstream failed" } } }),
  concurrencyQueueFull: (id) => ({ statusCode: 503, body: { error: { message: `Queue full: ${id}` } } }),
  concurrencyTimeout: (id, ms) => ({ statusCode: 504, body: { error: { message: `Timeout: ${id} ${ms}ms` } } }),
};

function createRequest(overrides = {}) {
  return {
    body: { model: "gpt-4", stream: false },
    headers: { "content-type": "application/json" },
    log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    raw: { socket: { on: vi.fn() }, on: vi.fn(), readableEnded: false },
    routerKey: null, ip: "127.0.0.1",
    ...overrides,
  } as any;
}

function createReply() {
  return {
    code: vi.fn().mockReturnThis(), status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis(), header: vi.fn().mockReturnThis(),
    raw: { headersSent: false, writableEnded: false, on: vi.fn(), removeListener: vi.fn() },
  } as any;
}

function createDeps(overrides = {}) {
  const container = new ServiceContainer();
  container.register("matcher", () => undefined);
  container.register("tracker", () => undefined);
  container.register("usageWindowTracker", () => ({ recordRequest: vi.fn() }));
  container.register("sessionTracker", () => undefined);
  container.register("adaptiveController", () => undefined);
  container.register("semaphoreManager", () => undefined);
  container.register(SERVICE_KEYS.logFileWriter, () => null);
  container.register(SERVICE_KEYS.pluginRegistry, () => undefined);
  container.register(SERVICE_KEYS.proxyAgentFactory, () => new ProxyAgentFactory());
  return {
    db: {} as any,
    orchestrator: { handle: vi.fn() } as any,
    container,
    ...overrides,
  };
}

const successResilienceResult: ResilienceResult = {
  result: { kind: "success" as const, statusCode: 200, body: '{"choices":[]}', headers: {}, sentHeaders: {}, sentBody: "" },
  attempts: [{ target: { backend_model: "gpt-4", provider_id: "p1" }, attemptIndex: 0, statusCode: 200, error: null, latencyMs: 50, responseBody: null }],
  excludedTargets: [],
};

const activeProvider = { id: "p1", name: "test", is_active: 1, api_type: "openai" as const, base_url: "http://x", api_key: "enc", models: "[]", max_concurrency: 0, queue_timeout_ms: 0, max_queue_size: 0, created_at: "", updated_at: "" };

describe("handleProxyRequest", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("映射找不到时返回 404", async () => {
    vi.mocked(resolveMapping).mockReturnValue(null);
    const deps = createDeps();
    const reply = createReply();
    await handleProxyRequest(createRequest(), reply, "openai", "/v1/chat/completions", errors, deps);
    expect(insertRejectedLog).toHaveBeenCalled();
    expect(reply.code).toHaveBeenCalledWith(404);
    expect(deps.orchestrator.handle).not.toHaveBeenCalled();
  });

  it("Provider 不可用时返回 503", async () => {
    vi.mocked(resolveMapping).mockReturnValue({ target: { backend_model: "gpt-4", provider_id: "p1" }, targetCount: 1 });
    vi.mocked(getProviderById).mockReturnValue({ ...activeProvider, is_active: 0 });
    const deps = createDeps();
    const reply = createReply();
    await handleProxyRequest(createRequest(), reply, "openai", "/v1/chat/completions", errors, deps);
    expect(reply.code).toHaveBeenCalledWith(503);
  });

  it("API type 不匹配时进行格式转换并调用 orchestrator", async () => {
    vi.mocked(resolveMapping).mockReturnValue({ target: { backend_model: "gpt-4", provider_id: "p1" }, targetCount: 1 });
    vi.mocked(getProviderById).mockReturnValue({ ...activeProvider, api_type: "anthropic" as const });
    const deps = createDeps();
    deps.orchestrator.handle = vi.fn().mockResolvedValue(successResilienceResult);
    const reply = createReply();
    await handleProxyRequest(createRequest(), reply, "openai", "/v1/chat/completions", errors, deps);
    // 不应该返回错误，而是应该调用 orchestrator 进行转发（转换后）
    expect(deps.orchestrator.handle).toHaveBeenCalledTimes(1);
  });

  it("正常请求调用 orchestrator 并记录日志", async () => {
    vi.mocked(resolveMapping).mockReturnValue({ target: { backend_model: "gpt-4", provider_id: "p1" }, targetCount: 1 });
    vi.mocked(getProviderById).mockReturnValue(activeProvider);
    const deps = createDeps();
    deps.orchestrator.handle = vi.fn().mockResolvedValue(successResilienceResult);
    const reply = createReply();
    await handleProxyRequest(createRequest(), reply, "openai", "/v1/chat/completions", errors, deps);
    expect(deps.orchestrator.handle).toHaveBeenCalledTimes(1);
    expect(logResilienceResult).toHaveBeenCalled();
    expect(collectTransportMetrics).toHaveBeenCalled();
  });

  it("ProviderSwitchNeeded 触发 failover 循环", async () => {
    vi.mocked(resolveMapping)
      .mockReturnValueOnce({ target: { backend_model: "gpt-4", provider_id: "p1" }, targetCount: 1 })
      .mockReturnValueOnce({ target: { backend_model: "gpt-4", provider_id: "p2" }, targetCount: 1 });
    vi.mocked(getProviderById)
      .mockReturnValueOnce(activeProvider)
      .mockReturnValueOnce({ ...activeProvider, id: "p2" });
    const deps = createDeps();
    deps.orchestrator.handle = vi.fn()
      .mockRejectedValueOnce(new ProviderSwitchNeeded("p2"))
      .mockResolvedValueOnce(successResilienceResult);
    await handleProxyRequest(createRequest(), createReply(), "openai", "/v1/chat/completions", errors, deps);
    expect(deps.orchestrator.handle).toHaveBeenCalledTimes(2);
  });

  it("SemaphoreQueueFullError 返回 503", async () => {
    vi.mocked(resolveMapping).mockReturnValue({ target: { backend_model: "gpt-4", provider_id: "p1" }, targetCount: 1 });
    vi.mocked(getProviderById).mockReturnValue(activeProvider);
    const deps = createDeps();
    deps.orchestrator.handle = vi.fn().mockRejectedValue(new SemaphoreQueueFullError("p1"));
    const reply = createReply();
    await handleProxyRequest(createRequest(), reply, "openai", "/v1/chat/completions", errors, deps);
    expect(reply.code).toHaveBeenCalledWith(503);
  });

  it("SemaphoreTimeoutError 返回 504", async () => {
    vi.mocked(resolveMapping).mockReturnValue({ target: { backend_model: "gpt-4", provider_id: "p1" }, targetCount: 1 });
    vi.mocked(getProviderById).mockReturnValue(activeProvider);
    const deps = createDeps();
    deps.orchestrator.handle = vi.fn().mockRejectedValue(new SemaphoreTimeoutError("p1", 5000));
    const reply = createReply();
    await handleProxyRequest(createRequest(), reply, "openai", "/v1/chat/completions", errors, deps);
    expect(reply.code).toHaveBeenCalledWith(504);
  });
});

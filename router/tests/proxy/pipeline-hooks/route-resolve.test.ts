/**
 * TC-2-01: builtin:route-resolve selects first non-excluded target
 * TC-2-02: builtin:route-resolve aborts when no targets available
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { routeResolveHook } from "../../../src/proxy/hooks/builtin/route-resolve.js";
import { PipelineAbort } from "../../../src/proxy/pipeline/types.js";
import type { PipelineContext, ProviderInfo } from "../../../src/proxy/pipeline/types.js";
import type { Target } from "../../../src/core/types.js";

/** 构造最小 mock PipelineContext */
function mockContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    request: { log: { debug: vi.fn(), error: vi.fn() } } as unknown as PipelineContext["request"],
    reply: {} as PipelineContext["reply"],
    rawBody: { model: "gpt-4o" },
    clientModel: "gpt-4o",
    apiType: "openai",
    body: { model: "gpt-4o" },
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
    snapshot: {} as PipelineContext["snapshot"],
    ...overrides,
  };
}

/** Mock getProviderById — 只需返回 ProviderInfo 形状 */
vi.mock("../../../src/db/index.js", () => ({
  getProviderById: vi.fn(),
}));

import { getProviderById } from "../../../src/db/index.js";
const mockGetProviderById = vi.mocked(getProviderById);

describe("builtin:route-resolve", () => {
  const activeProvider: ProviderInfo = {
    id: "provider-1",
    name: "Test Provider",
    base_url: "https://api.test.com",
    api_type: "openai",
    is_active: 1,
    api_key: "encrypted-key",
    models: "[]",
    upstream_path: null,
    max_concurrency: 10,
    queue_timeout_ms: 30000,
    max_queue_size: 100,
    adaptive_enabled: 0,
    created_at: new Date().toISOString(),
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("TC-2-01: selects first non-excluded target and sets ctx.resolved/provider", () => {
    const targets: Target[] = [
      { backend_model: "gpt-4o-mini", provider_id: "provider-1" },
      { backend_model: "gpt-4o", provider_id: "provider-2" },
    ];
    const excluded: Target[] = [
      { backend_model: "gpt-4o-mini", provider_id: "provider-1" },
    ];

    mockGetProviderById.mockReturnValue(activeProvider);

    const ctx = mockContext();
    ctx.metadata.set("db", {} as never);
    ctx.metadata.set("cachedTargets", targets);
    ctx.metadata.set("excludeTargets", excluded);

    routeResolveHook.execute(ctx);

    expect(ctx.resolved).toEqual({
      backend_model: "gpt-4o",
      provider_id: "provider-2",
    });
    expect(ctx.provider).toBe(activeProvider);
    // body.model 应被更新为 resolved.backend_model
    expect(ctx.body.model).toBe("gpt-4o");
  });

  it("TC-2-01: selects first target when no excludes", () => {
    const targets: Target[] = [
      { backend_model: "gpt-4o-mini", provider_id: "provider-1" },
    ];

    mockGetProviderById.mockReturnValue(activeProvider);

    const ctx = mockContext();
    ctx.metadata.set("db", {} as never);
    ctx.metadata.set("cachedTargets", targets);
    ctx.metadata.set("excludeTargets", []);

    routeResolveHook.execute(ctx);

    expect(ctx.resolved).toEqual({
      backend_model: "gpt-4o-mini",
      provider_id: "provider-1",
    });
    expect(ctx.body.model).toBe("gpt-4o-mini");
  });

  it("TC-2-02: aborts with 503 when all targets excluded (openai format)", () => {
    const targets: Target[] = [
      { backend_model: "gpt-4o-mini", provider_id: "provider-1" },
    ];
    const excluded: Target[] = [
      { backend_model: "gpt-4o-mini", provider_id: "provider-1" },
    ];

    const ctx = mockContext({ apiType: "openai" });
    ctx.metadata.set("db", {} as never);
    ctx.metadata.set("cachedTargets", targets);
    ctx.metadata.set("excludeTargets", excluded);

    expect(() => routeResolveHook.execute(ctx)).toThrow(PipelineAbort);

    try {
      routeResolveHook.execute(ctx);
    } catch (e) {
      const abort = e as PipelineAbort;
      expect(abort.statusCode).toBe(503);
      expect((abort.body as { error: { code: string } }).error.code).toBe("failover_limit_exceeded");
    }
  });

  it("TC-2-02: aborts with 503 when all targets excluded (anthropic format)", () => {
    const targets: Target[] = [
      { backend_model: "claude-3", provider_id: "provider-1" },
    ];
    const excluded: Target[] = [
      { backend_model: "claude-3", provider_id: "provider-1" },
    ];

    const ctx = mockContext({ apiType: "anthropic" });
    ctx.metadata.set("db", {} as never);
    ctx.metadata.set("cachedTargets", targets);
    ctx.metadata.set("excludeTargets", excluded);

    try {
      routeResolveHook.execute(ctx);
      expect.unreachable("Should have thrown PipelineAbort");
    } catch (e) {
      const abort = e as PipelineAbort;
      expect(abort.statusCode).toBe(503);
      expect((abort.body as { type: string }).type).toBe("error");
    }
  });

  it("TC-2-02: aborts when provider not found in DB", () => {
    const targets: Target[] = [
      { backend_model: "gpt-4o", provider_id: "missing-provider" },
    ];

    mockGetProviderById.mockReturnValue(undefined);

    const ctx = mockContext();
    ctx.metadata.set("db", {} as never);
    ctx.metadata.set("cachedTargets", targets);
    ctx.metadata.set("excludeTargets", []);

    expect(() => routeResolveHook.execute(ctx)).toThrow(PipelineAbort);
  });

  it("TC-2-02: aborts when provider is inactive", () => {
    const targets: Target[] = [
      { backend_model: "gpt-4o", provider_id: "inactive-provider" },
    ];

    mockGetProviderById.mockReturnValue({ ...activeProvider, is_active: 0 });

    const ctx = mockContext();
    ctx.metadata.set("db", {} as never);
    ctx.metadata.set("cachedTargets", targets);
    ctx.metadata.set("excludeTargets", []);

    expect(() => routeResolveHook.execute(ctx)).toThrow(PipelineAbort);
  });
});

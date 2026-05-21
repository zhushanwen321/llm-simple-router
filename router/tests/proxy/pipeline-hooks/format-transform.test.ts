/**
 * TC-3-01: builtin:format-transform converts openai to anthropic
 */
import { describe, it, expect, vi } from "vitest";
import { formatTransformHook } from "../../../src/proxy/hooks/builtin/format-transform.js";
import type { PipelineContext, ProviderInfo } from "../../../src/proxy/pipeline/types.js";
import { ServiceContainer } from "../../../src/core/container.js";
import { SERVICE_KEYS } from "../../../src/core/container.js";
import { FormatRegistry } from "../../../src/proxy/format/registry.js";

function mockContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    request: { log: { debug: vi.fn(), error: vi.fn() } } as unknown as PipelineContext["request"],
    reply: {} as PipelineContext["reply"],
    rawBody: { model: "gpt-4o", messages: [{ role: "user", content: "hello" }] },
    clientModel: "gpt-4o",
    apiType: "openai",
    body: { model: "gpt-4o", messages: [{ role: "user", content: "hello" }] },
    isStream: false,
    resolved: { backend_model: "claude-3", provider_id: "provider-1" },
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

const anthropicProvider: ProviderInfo = {
  id: "provider-1",
  name: "Anthropic Provider",
  base_url: "https://api.anthropic.com",
  api_type: "anthropic",
  is_active: 1,
  api_key: "test-key",
  models: "[]",
  upstream_path: null,
  max_concurrency: 10,
  queue_timeout_ms: 30000,
  max_queue_size: 100,
  adaptive_enabled: 0,
  created_at: new Date().toISOString(),
};

describe("builtin:format-transform", () => {
  it("TC-3-01: transforms request when client and provider api types differ", () => {
    const registry = new FormatRegistry();
    registry.registerAdapter({
      apiType: "anthropic",
      defaultPath: "/v1/messages",
      transformStreamChunk: vi.fn(),
      parseSSEEvent: vi.fn(),
    });
    registry.registerConverter({
      sourceType: "openai",
      targetType: "anthropic",
      transformRequest: (body, _model) => ({
        model: _model,
        messages: body.messages,
        system: "converted",
      }),
      transformResponse: vi.fn(),
    });

    const container = new ServiceContainer();
    container.register(SERVICE_KEYS.formatRegistry, () => registry);

    const ctx = mockContext();
    ctx.provider = anthropicProvider;
    ctx.metadata.set("container", container);
    ctx.metadata.set("defaultUpstreamPath", "/v1/chat/completions");

    formatTransformHook.execute(ctx);

    // body 应该被转换
    expect(ctx.body).toHaveProperty("system", "converted");
    // effectiveApiType 应该是 provider 的 api_type
    expect(ctx.effectiveApiType).toBe("anthropic");
    // effectiveUpstreamPath 应该从 adapter 获取
    expect(ctx.effectiveUpstreamPath).toBe("/v1/messages");
    // needsTransform metadata
    expect(ctx.metadata.get("needsTransform")).toBe(true);
  });

  it("does not transform when api types match", () => {
    const registry = new FormatRegistry();

    const container = new ServiceContainer();
    container.register(SERVICE_KEYS.formatRegistry, () => registry);

    const openaiProvider: ProviderInfo = {
      ...anthropicProvider,
      api_type: "openai",
    };

    const ctx = mockContext();
    ctx.provider = openaiProvider;
    ctx.metadata.set("container", container);
    ctx.metadata.set("defaultUpstreamPath", "/v1/chat/completions");

    formatTransformHook.execute(ctx);

    // body 不应改变
    expect(ctx.body).toEqual({ model: "gpt-4o", messages: [{ role: "user", content: "hello" }] });
    expect(ctx.effectiveApiType).toBe("openai");
    expect(ctx.effectiveUpstreamPath).toBe("/v1/chat/completions");
    expect(ctx.metadata.get("needsTransform")).toBe(false);
  });

  it("provider upstream_path overrides computed upstream path", () => {
    const registry = new FormatRegistry();

    const container = new ServiceContainer();
    container.register(SERVICE_KEYS.formatRegistry, () => registry);

    const customProvider: ProviderInfo = {
      ...anthropicProvider,
      api_type: "openai",
      upstream_path: "/custom/v1/chat",
    };

    const ctx = mockContext();
    ctx.provider = customProvider;
    ctx.metadata.set("container", container);
    ctx.metadata.set("defaultUpstreamPath", "/v1/chat/completions");

    formatTransformHook.execute(ctx);

    expect(ctx.effectiveUpstreamPath).toBe("/custom/v1/chat");
  });
});

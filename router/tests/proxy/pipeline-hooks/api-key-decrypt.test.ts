/**
 * TC-4-01: builtin:api-key-decrypt caches per provider
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { apiKeyDecryptHook } from "../../../src/proxy/hooks/builtin/api-key-decrypt.js";
import { PipelineAbort } from "../../../src/proxy/pipeline/types.js";
import type { PipelineContext, ProviderInfo } from "../../../src/proxy/pipeline/types.js";

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

const mockProvider: ProviderInfo = {
  id: "provider-1",
  name: "Test Provider",
  base_url: "https://api.test.com",
  api_type: "openai",
  is_active: 1,
  api_key: "iv:authTag:ciphertext",
  models: "[]",
  upstream_path: null,
  max_concurrency: 10,
  queue_timeout_ms: 30000,
  max_queue_size: 100,
  adaptive_enabled: 0,
  created_at: new Date().toISOString(),
};

vi.mock("../../../src/db/settings.js", () => ({
  getSetting: vi.fn(),
}));

vi.mock("../../../src/utils/crypto.js", () => ({
  decrypt: vi.fn(),
}));

import { getSetting } from "../../../src/db/settings.js";
import { decrypt } from "../../../src/utils/crypto.js";

const mockGetSetting = vi.mocked(getSetting);
const mockDecrypt = vi.mocked(decrypt);

describe("builtin:api-key-decrypt", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("TC-4-01: decrypts api key and caches result in decryptedApiKeys map", () => {
    mockGetSetting.mockReturnValue("encryption-key-value");
    mockDecrypt.mockReturnValue("decrypted-api-key");

    const decryptedApiKeys = new Map<string, string>();
    const ctx = mockContext();
    ctx.provider = mockProvider;
    ctx.metadata.set("db", {} as never);
    ctx.metadata.set("decryptedApiKeys", decryptedApiKeys);

    apiKeyDecryptHook.execute(ctx);

    // 应调用 decrypt 并缓存
    expect(mockDecrypt).toHaveBeenCalledWith("iv:authTag:ciphertext", "encryption-key-value");
    expect(decryptedApiKeys.get("provider-1")).toBe("decrypted-api-key");
    expect(ctx.metadata.get("apiKey")).toBe("decrypted-api-key");
  });

  it("TC-4-01: uses cached key without calling decrypt again", () => {
    mockGetSetting.mockReturnValue("encryption-key-value");

    const decryptedApiKeys = new Map<string, string>();
    decryptedApiKeys.set("provider-1", "cached-decrypted-key");

    const ctx = mockContext();
    ctx.provider = mockProvider;
    ctx.metadata.set("db", {} as never);
    ctx.metadata.set("decryptedApiKeys", decryptedApiKeys);

    apiKeyDecryptHook.execute(ctx);

    // 不应调用 decrypt
    expect(mockDecrypt).not.toHaveBeenCalled();
    expect(ctx.metadata.get("apiKey")).toBe("cached-decrypted-key");
  });

  it("TC-4-01: multiple providers cached independently", () => {
    mockGetSetting.mockReturnValue("encryption-key-value");
    mockDecrypt.mockImplementationOnce(() => "key-provider-1");
    mockDecrypt.mockImplementationOnce(() => "key-provider-2");

    const decryptedApiKeys = new Map<string, string>();

    // First provider
    const ctx1 = mockContext();
    ctx1.provider = mockProvider;
    ctx1.metadata.set("db", {} as never);
    ctx1.metadata.set("decryptedApiKeys", decryptedApiKeys);
    apiKeyDecryptHook.execute(ctx1);

    // Second provider
    const provider2 = { ...mockProvider, id: "provider-2", api_key: "iv2:tag2:ct2" };
    const ctx2 = mockContext();
    ctx2.provider = provider2;
    ctx2.metadata.set("db", {} as never);
    ctx2.metadata.set("decryptedApiKeys", decryptedApiKeys);
    apiKeyDecryptHook.execute(ctx2);

    expect(decryptedApiKeys.size).toBe(2);
    expect(decryptedApiKeys.get("provider-1")).toBe("key-provider-1");
    expect(decryptedApiKeys.get("provider-2")).toBe("key-provider-2");
  });

  it("throws PipelineAbort when encryption_key not configured", () => {
    mockGetSetting.mockReturnValue(null);

    const ctx = mockContext();
    ctx.provider = mockProvider;
    ctx.metadata.set("db", {} as never);
    ctx.metadata.set("decryptedApiKeys", new Map());

    expect(() => apiKeyDecryptHook.execute(ctx)).toThrow(PipelineAbort);

    try {
      apiKeyDecryptHook.execute(ctx);
    } catch (e) {
      const abort = e as PipelineAbort;
      expect(abort.statusCode).toBe(503);
      expect((abort.body as { error: { code: string } }).error.code).toBe("provider_unavailable");
    }
  });

  it("throws PipelineAbort with anthropic error format for anthropic requests", () => {
    mockGetSetting.mockReturnValue(null);

    const ctx = mockContext({ apiType: "anthropic" });
    ctx.provider = mockProvider;
    ctx.metadata.set("db", {} as never);
    ctx.metadata.set("decryptedApiKeys", new Map());

    try {
      apiKeyDecryptHook.execute(ctx);
      expect.unreachable("Should have thrown PipelineAbort");
    } catch (e) {
      const abort = e as PipelineAbort;
      expect(abort.statusCode).toBe(503);
      expect((abort.body as { type: string }).type).toBe("error");
    }
  });
});

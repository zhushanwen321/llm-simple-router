/**
 * BG1 Task 4: builtin:api-key-decrypt hook 测试
 *
 * 测试用例：
 * 1. 成功解密 API key 并写入 metadata
 * 2. encryption_key 不存在 → PipelineAbort(503)（OpenAI + Anthropic 格式）
 * 3. 同一 provider 第二次调用使用缓存
 * 4. 不同 provider 各自独立缓存
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock getSetting 和 decrypt
vi.mock("../../../src/db/settings.js", () => ({
  getSetting: vi.fn(),
}));

vi.mock("../../../src/utils/crypto.js", () => ({
  decrypt: vi.fn(),
}));

import { getSetting } from "../../../src/db/settings.js";
import { decrypt } from "../../../src/utils/crypto.js";
import { apiKeyDecryptHook } from "../../../src/proxy/hooks/builtin/api-key-decrypt.js";
import { PipelineAbort } from "../../../src/proxy/pipeline/types.js";
import type { PipelineContext, ProviderInfo } from "../../../src/proxy/pipeline/types.js";

const mockGetSetting = vi.mocked(getSetting);
const mockDecrypt = vi.mocked(decrypt);

/** 构造最小 PipelineContext */
function makeContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    request: { log: { error: vi.fn() } } as unknown as PipelineContext["request"],
    reply: {} as PipelineContext["reply"],
    rawBody: {},
    clientModel: "gpt-4o",
    apiType: "openai",
    body: {},
    isStream: false,
    resolved: null,
    provider: null,
    effectiveUpstreamPath: "",
    effectiveApiType: "",
    injectedHeaders: {},
    metadata: new Map(),
    logId: "test-log-id",
    rootLogId: null,
    transportResult: null,
    resilienceResult: null,
    clientRequest: "",
    upstreamRequest: "",
    snapshot: {} as PipelineContext["snapshot"],
    deps: {
      setup: {
        db: {} as any,
        container: {} as any,
        orchestrator: {} as any,
        matcher: null as any,
        tracker: {} as any,
        retryBaseDelayMs: 1000,
        logFileWriter: null,
        errors: {} as any,
        usageWindowTracker: {} as any,
        proxyAgentFactory: {} as any,
      },
      request: {
        cachedTargets: undefined as any,
        overflowIndices: undefined as any,
        resolveResult: undefined as any,
        precomputeSnapshot: undefined as any,
        decryptedApiKeys: undefined as any,
        enhancementConfig: {
          tool_call_loop_enabled: false,
          stream_loop_enabled: false,
          tool_round_limit_enabled: false,
          tool_error_logging_enabled: false,
        },
        adapter: {} as any,
        defaultUpstreamPath: "",
        clientHeaders: {},
        precomputedClientReq: "",
        concurrencyOverride: null,
      },
    },
    ...overrides,
  };
}

/** 构造 mock ProviderInfo */
function makeProvider(id: string, apiKey = "enc:apikey"): ProviderInfo {
  return {
    id,
    name: `provider-${id}`,
    base_url: "https://api.example.com",
    api_type: "openai",
    is_active: 1,
    api_key: apiKey,
    models: "[]",
    upstream_path: null,
    max_concurrency: 10,
    queue_timeout_ms: 30000,
    max_queue_size: 100,
    adaptive_enabled: false,
    created_at: "2024-01-01",
  };
}

describe("builtin:api-key-decrypt hook", () => {
  const fakeDb = {} as import("better-sqlite3").Database;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("成功解密 API key 并写入 metadata", () => {
    mockGetSetting.mockReturnValue("deadbeef");
    mockDecrypt.mockReturnValue("sk-real-key");

    const decryptedApiKeys = new Map<string, string>();
    const ctx = makeContext({
      apiType: "openai",
      provider: makeProvider("p1"),
      metadata: new Map([
        ["db", fakeDb],
        ["decryptedApiKeys", decryptedApiKeys],
      ]),
    });

    apiKeyDecryptHook.execute(ctx);

    expect(mockDecrypt).toHaveBeenCalledWith("enc:apikey", "deadbeef");
    expect(ctx.metadata.get("apiKey")).toBe("sk-real-key");
    expect(decryptedApiKeys.get("p1")).toBe("sk-real-key");
  });

  it("encryption_key 不存在 → PipelineAbort(503, OpenAI 格式错误)", () => {
    mockGetSetting.mockReturnValue(null);

    const ctx = makeContext({
      apiType: "openai",
      provider: makeProvider("p1"),
      metadata: new Map([
        ["db", fakeDb],
        ["decryptedApiKeys", new Map()],
      ]),
    });

    expect(() => apiKeyDecryptHook.execute(ctx)).toThrow(PipelineAbort);
    try {
      apiKeyDecryptHook.execute(ctx);
    } catch (e) {
      const abort = e as PipelineAbort;
      expect(abort.statusCode).toBe(503);
      expect(abort.body).toEqual({
        error: {
          message: "Encryption key not configured",
          type: "server_error",
          code: "provider_unavailable",
        },
      });
    }
  });

  it("encryption_key 不存在 → PipelineAbort(503, Anthropic 格式错误)", () => {
    mockGetSetting.mockReturnValue(null);

    const ctx = makeContext({
      apiType: "anthropic",
      provider: makeProvider("p1"),
      metadata: new Map([
        ["db", fakeDb],
        ["decryptedApiKeys", new Map()],
      ]),
    });

    expect(() => apiKeyDecryptHook.execute(ctx)).toThrow(PipelineAbort);
    try {
      apiKeyDecryptHook.execute(ctx);
    } catch (e) {
      const abort = e as PipelineAbort;
      expect(abort.statusCode).toBe(503);
      expect(abort.body).toEqual({
        type: "error",
        error: { type: "api_error", message: "Encryption key not configured" },
      });
    }
  });

  it("同一 provider 第二次调用使用缓存（decrypt 不再调用）", () => {
    mockGetSetting.mockReturnValue("deadbeef");
    mockDecrypt.mockReturnValue("sk-cached-key");

    const decryptedApiKeys = new Map<string, string>();
    const ctx = makeContext({
      apiType: "openai",
      provider: makeProvider("p1"),
      metadata: new Map([
        ["db", fakeDb],
        ["decryptedApiKeys", decryptedApiKeys],
      ]),
    });

    // 第一次：decrypt 被调用
    apiKeyDecryptHook.execute(ctx);
    expect(mockDecrypt).toHaveBeenCalledTimes(1);
    expect(ctx.metadata.get("apiKey")).toBe("sk-cached-key");

    mockDecrypt.mockClear();

    // 第二次：缓存命中，decrypt 不再调用
    apiKeyDecryptHook.execute(ctx);
    expect(mockDecrypt).not.toHaveBeenCalled();
    expect(ctx.metadata.get("apiKey")).toBe("sk-cached-key");
  });

  it("不同 provider 各自独立缓存", () => {
    mockGetSetting.mockReturnValue("deadbeef");
    mockDecrypt
      .mockReturnValueOnce("sk-key-a")
      .mockReturnValueOnce("sk-key-b");

    const decryptedApiKeys = new Map<string, string>();

    // Provider A
    const ctxA = makeContext({
      apiType: "openai",
      provider: makeProvider("prov-a", "enc-key-a"),
      metadata: new Map([
        ["db", fakeDb],
        ["decryptedApiKeys", decryptedApiKeys],
      ]),
    });
    apiKeyDecryptHook.execute(ctxA);
    expect(ctxA.metadata.get("apiKey")).toBe("sk-key-a");

    // Provider B（共享同一个 decryptedApiKeys Map）
    const ctxB = makeContext({
      apiType: "openai",
      provider: makeProvider("prov-b", "enc-key-b"),
      metadata: new Map([
        ["db", fakeDb],
        ["decryptedApiKeys", decryptedApiKeys],
      ]),
    });
    apiKeyDecryptHook.execute(ctxB);
    expect(ctxB.metadata.get("apiKey")).toBe("sk-key-b");

    // 各自缓存
    expect(decryptedApiKeys.get("prov-a")).toBe("sk-key-a");
    expect(decryptedApiKeys.get("prov-b")).toBe("sk-key-b");
    expect(mockDecrypt).toHaveBeenCalledTimes(2);
  });
});

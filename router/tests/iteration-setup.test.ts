/**
 * Unit tests for buildIterationSetup (extracted from failover-loop).
 *
 * Covers the encryption-key-missing branch (returns ok:false)
 * and the happy-path branch (returns ok:true with transportFn).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { buildIterationSetup } from "../src/proxy/handler/iteration-setup.js";
import { FormatRegistry } from "../src/proxy/format/registry.js";
import { RetryRuleMatcher } from "../src/proxy/orchestration/retry-rules.js";
import { PipelineSnapshot } from "../src/proxy/pipeline-snapshot.js";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { hashPassword } from "../src/utils/password.js";
import { encrypt } from "../src/utils/crypto.js";
import type { Provider } from "../src/db/providers.js";
import type { Target } from "../src/core/types.js";
import { makeErrors, makeMockReply, makeMockRequest, makeRCtx } from "./helpers/test-mock-factories.js";

// ---------- Local mock factories ----------

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: "test-provider",
    name: "Test Provider",
    api_type: "openai",
    base_url: "https://api.example.com",
    upstream_path: null,
    api_key: "encrypted-key",
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
    ...overrides,
  };
}

function makeFormatAdapter() {
  return {
    apiType: "openai",
    defaultPath: "/v1/chat/completions",
    errorMeta: {},
    formatError: (message: string) => ({ error: { message, type: "server_error" } }),
  };
}

// ---------- Tests ----------

describe("buildIterationSetup", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:") as Database.Database;
    // Setup settings so rejectAndReply can work
    setSetting(db, "password_hash", hashPassword("test"));
    setSetting(db, "encryption_key", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  });

  it("should return ok:false when encryptionKey is null", () => {
    const reply = makeMockReply();
    const result = buildIterationSetup({
      formatRegistry: new FormatRegistry(),
      pluginRegistry: undefined as never,
      currentBody: { model: "gpt-4", messages: [] },
      ctxApiType: "openai",
      clientApiType: "openai",
      provider: makeProvider(),
      resolved: { backend_model: "gpt-4", provider_id: "test-provider" } as Target,
      upstreamPath: "/v1/chat/completions",
      encryptionKey: null,
      cliHdrs: {},
      reply,
      startTime: Date.now(),
      logId: "test-log-id",
      clientModel: "gpt-4",
      precomputedClientReq: "{}",
      enhancementConfig: {
        tool_call_loop_enabled: false,
        stream_loop_enabled: false,
        tool_round_limit_enabled: false,
        tool_error_logging_enabled: false,
      },
      tracker: undefined as never,
      matcher: new RetryRuleMatcher(),
      request: makeMockRequest(),
      adapter: makeFormatAdapter(),
      proxyAgentFactory: undefined,
      iterationSnapshot: new PipelineSnapshot(),
      effectiveMappingReason: "direct_format",
      isStream: false,
      isFailover: false,
      flushToolErrors: vi.fn(),
      errors: makeErrors(),
      rCtx: makeRCtx(db),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reply).toBe(reply);
    }
  });

  it("should return ok:true with transportFn when encryptionKey is provided", () => {
    const encryptionKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const encryptedApiKey = encrypt("test-api-key", encryptionKey);
    const provider = makeProvider({ api_key: encryptedApiKey });
    const result = buildIterationSetup({
      formatRegistry: new FormatRegistry(),
      pluginRegistry: undefined as never,
      currentBody: { model: "gpt-4", messages: [] },
      ctxApiType: "openai",
      clientApiType: "openai",
      provider,
      resolved: { backend_model: "gpt-4", provider_id: "test-provider" } as Target,
      upstreamPath: "/v1/chat/completions",
      encryptionKey,
      cliHdrs: {},
      reply: makeMockReply(),
      startTime: Date.now(),
      logId: "test-log-id",
      clientModel: "gpt-4",
      precomputedClientReq: "{}",
      enhancementConfig: {
        tool_call_loop_enabled: false,
        stream_loop_enabled: false,
        tool_round_limit_enabled: false,
        tool_error_logging_enabled: false,
      },
      tracker: undefined as never,
      matcher: new RetryRuleMatcher(),
      request: makeMockRequest(),
      adapter: makeFormatAdapter(),
      proxyAgentFactory: undefined,
      iterationSnapshot: new PipelineSnapshot(),
      effectiveMappingReason: "direct_format",
      isStream: false,
      isFailover: false,
      flushToolErrors: vi.fn(),
      errors: makeErrors(),
      rCtx: makeRCtx(db),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transportFn).toBeDefined();
      expect(result.upstreamReqBase).toBeDefined();
      expect(result.pipelineSnapshot).toBeDefined();
      expect(result.resolvedEndpoint).toBeDefined();
      expect(result.flushCurrentErrors).toBeDefined();
    }
  });

  it("should snapshot routing stage with correct metadata", () => {
    const encryptionKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const encryptedApiKey = encrypt("test-api-key", encryptionKey);
    const snapshot = new PipelineSnapshot();

    buildIterationSetup({
      formatRegistry: new FormatRegistry(),
      pluginRegistry: undefined as never,
      currentBody: { model: "gpt-4", messages: [] },
      ctxApiType: "openai",
      clientApiType: "openai",
      provider: makeProvider({ api_key: encryptedApiKey }),
      resolved: { backend_model: "gpt-4", provider_id: "test-provider" } as Target,
      upstreamPath: "/v1/chat/completions",
      encryptionKey,
      cliHdrs: {},
      reply: makeMockReply(),
      startTime: Date.now(),
      logId: "test-log-id",
      clientModel: "gpt-4",
      precomputedClientReq: "{}",
      enhancementConfig: {
        tool_call_loop_enabled: false,
        stream_loop_enabled: false,
        tool_round_limit_enabled: false,
        tool_error_logging_enabled: false,
      },
      tracker: undefined as never,
      matcher: new RetryRuleMatcher(),
      request: makeMockRequest(),
      adapter: makeFormatAdapter(),
      proxyAgentFactory: undefined,
      iterationSnapshot: snapshot,
      effectiveMappingReason: "group_schedule",
      isStream: false,
      isFailover: true,
      flushToolErrors: vi.fn(),
      errors: makeErrors(),
      rCtx: makeRCtx(db),
    });

    const stages = snapshot.getStages();
    const routingStage = stages.find((s) => s.stage === "routing");
    expect(routingStage).toBeDefined();
    if (routingStage && routingStage.stage === "routing") {
      expect(routingStage.strategy).toBe("failover");
      expect(routingStage.mapping_reason).toBe("group_schedule");
      expect(routingStage.provider_id).toBe("test-provider");
    }
  });
});

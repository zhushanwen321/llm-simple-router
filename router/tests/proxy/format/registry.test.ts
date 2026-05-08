import { describe, it, expect } from "vitest";
import { FormatRegistry } from "../../../src/proxy/format/registry.js";
import type { FormatAdapter, FormatConverter } from "../../../src/proxy/format/types.js";
import { Transform } from "stream";

const openaiAdapter: FormatAdapter = {
  apiType: "openai",
  defaultPath: "/v1/chat/completions",
  errorMeta: {
    modelNotFound: { type: "invalid_request_error", code: "model_not_found" },
    providerUnavailable: { type: "server_error", code: "provider_unavailable" },
    upstreamConnectionFailed: { type: "upstream_error", code: "upstream_connection_failed" },
    concurrencyQueueFull: { type: "server_error", code: "concurrency_queue_full" },
    concurrencyTimeout: { type: "server_error", code: "concurrency_timeout" },
    modelNotAllowed: { type: "invalid_request_error", code: "model_not_allowed" },
    providerTypeMismatch: { type: "server_error", code: "provider_type_mismatch" },
    promptTooLong: { type: "invalid_request_error", code: "context_window_exceeded" },
  },
  beforeSendProxy(body, isStream) {
    if (isStream && !body.stream_options) {
      body.stream_options = { include_usage: true };
    }
  },
  formatError(message, code) {
    return { error: { message, type: "upstream_error", code: code ?? "upstream_error" } };
  },
};

const anthropicAdapter: FormatAdapter = {
  apiType: "anthropic",
  defaultPath: "/v1/messages",
  errorMeta: {
    modelNotFound: { type: "not_found_error", code: "model_not_found" },
    providerUnavailable: { type: "api_error", code: "provider_unavailable" },
    upstreamConnectionFailed: { type: "upstream_error", code: "upstream_connection_failed" },
    concurrencyQueueFull: { type: "api_error", code: "concurrency_queue_full" },
    concurrencyTimeout: { type: "api_error", code: "concurrency_timeout" },
    modelNotAllowed: { type: "forbidden_error", code: "model_not_allowed" },
    providerTypeMismatch: { type: "api_error", code: "provider_type_mismatch" },
    promptTooLong: { type: "invalid_request_error", code: "context_window_exceeded" },
  },
  formatError(message) {
    return { type: "error", error: { type: "api_error", message } };
  },
};

function createMockConverter(source: string, target: string): FormatConverter {
  return {
    sourceType: source,
    targetType: target,
    transformRequest(body, _model) {
      return { body: { ...body, _converted: `${source}->${target}` }, upstreamPath: `/v1/${target}` };
    },
    transformResponse(bodyStr) {
      const parsed = JSON.parse(bodyStr);
      return JSON.stringify({ ...parsed, _converted: `${source}->${target}` });
    },
    createStreamTransform(_model) {
      return new Transform({ transform(chunk, _, cb) { cb(null, chunk); } });
    },
  };
}

describe("FormatRegistry", () => {
  it("needsTransform returns false for same type", () => {
    const registry = new FormatRegistry();
    expect(registry.needsTransform("openai", "openai")).toBe(false);
  });

  it("needsTransform returns true for different types", () => {
    const registry = new FormatRegistry();
    expect(registry.needsTransform("openai", "anthropic")).toBe(true);
  });

  it("getAdapter returns registered adapter", () => {
    const registry = new FormatRegistry();
    registry.registerAdapter(openaiAdapter);
    expect(registry.getAdapter("openai")).toBe(openaiAdapter);
  });

  it("getAdapter returns undefined for unknown type", () => {
    const registry = new FormatRegistry();
    expect(registry.getAdapter("gemini")).toBeUndefined();
  });

  it("transformRequest delegates to converter", () => {
    const registry = new FormatRegistry();
    registry.registerAdapter(openaiAdapter);
    registry.registerAdapter(anthropicAdapter);
    registry.registerConverter(createMockConverter("openai", "anthropic"));

    const result = registry.transformRequest({ messages: [] }, "openai", "anthropic", "gpt-4");
    expect(result.body._converted).toBe("openai->anthropic");
    expect(result.upstreamPath).toBe("/v1/anthropic");
  });

  it("transformRequest returns original body when no converter", () => {
    const registry = new FormatRegistry();
    const body = { messages: [] };
    const result = registry.transformRequest(body, "openai", "gemini", "gpt-4");
    expect(result.body).toBe(body);
  });

  it("transformResponse delegates to converter", () => {
    const registry = new FormatRegistry();
    registry.registerConverter(createMockConverter("openai", "anthropic"));

    const result = registry.transformResponse('{"choices":[]}', "openai", "anthropic");
    const parsed = JSON.parse(result);
    expect(parsed._converted).toBe("openai->anthropic");
  });

  it("transformResponse returns original when no converter", () => {
    const registry = new FormatRegistry();
    expect(registry.transformResponse('{"ok":true}', "openai", "gemini")).toBe('{"ok":true}');
  });

  it("transformError extracts message and formats with target adapter", () => {
    const registry = new FormatRegistry();
    registry.registerAdapter(openaiAdapter);
    registry.registerAdapter(anthropicAdapter);

    const result = registry.transformError(
      '{"error":{"message":"model not found"}}',
      "openai",
      "anthropic",
    );
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe("error");
    expect(parsed.error.message).toBe("model not found");
  });

  it("transformError returns original when source===target", () => {
    const registry = new FormatRegistry();
    const body = '{"error":{"message":"fail"}}';
    expect(registry.transformError(body, "openai", "openai")).toBe(body);
  });

  it("createStreamTransform returns undefined when no converter", () => {
    const registry = new FormatRegistry();
    expect(registry.createStreamTransform("openai", "gemini", "gpt-4")).toBeUndefined();
  });

  it("createStreamTransform returns Transform when converter exists", () => {
    const registry = new FormatRegistry();
    registry.registerConverter(createMockConverter("openai", "anthropic"));
    expect(registry.createStreamTransform("openai", "anthropic", "gpt-4")).toBeDefined();
  });
});

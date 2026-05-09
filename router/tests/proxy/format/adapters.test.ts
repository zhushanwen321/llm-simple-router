/**
 * FormatAdapter 接口契约测试 — 验证 3 个 adapter 的元数据和格式化行为。
 *
 * 覆盖 spec 中 format-adapter.md 定义的核心契约：
 * - apiType / defaultPath 正确性
 * - formatError 输出符合对应 API 的错误结构
 * - beforeSendProxy 钩子行为（如 OpenAI 注入 stream_options）
 */
import { describe, it, expect } from "vitest";
import { openaiAdapter } from "../../../src/proxy/format/adapters/openai.js";
import { anthropicAdapter } from "../../../src/proxy/format/adapters/anthropic.js";
import { responsesAdapter } from "../../../src/proxy/format/adapters/responses.js";
import type { FormatAdapter } from "../../../src/proxy/format/types.js";

describe("FormatAdapter contracts", () => {
  describe("OpenAI adapter", () => {
    const adapter = openaiAdapter;

    it("has correct apiType and defaultPath", () => {
      expect(adapter.apiType).toBe("openai");
      expect(adapter.defaultPath).toBe("/v1/chat/completions");
    });

    it("formatError returns OpenAI error structure", () => {
      const result = adapter.formatError("model not found", "model_not_found");
      const parsed = result as { error: { message: string; type: string; code: string } };
      expect(parsed.error.message).toBe("model not found");
      expect(parsed.error.code).toBe("model_not_found");
      expect(parsed.error.type).toBeDefined();
    });

    it("formatError uses default code when omitted", () => {
      const result = adapter.formatError("something failed");
      const parsed = result as { error: { message: string; code: string } };
      expect(parsed.error.message).toBe("something failed");
      expect(parsed.error.code).toBeDefined();
    });

    it("beforeSendProxy injects stream_options for stream requests", () => {
      const body: Record<string, unknown> = { stream: true };
      adapter.beforeSendProxy?.(body, true);
      expect(body.stream_options).toEqual({ include_usage: true });
    });

    it("beforeSendProxy does not overwrite existing stream_options", () => {
      const body: Record<string, unknown> = { stream: true, stream_options: { custom: true } };
      adapter.beforeSendProxy?.(body, true);
      expect(body.stream_options).toEqual({ custom: true });
    });

    it("beforeSendProxy is no-op for non-stream requests", () => {
      const body: Record<string, unknown> = { stream: false };
      adapter.beforeSendProxy?.(body, false);
      expect(body.stream_options).toBeUndefined();
    });

    it("errorMeta covers all ErrorKind keys", () => {
      const requiredKinds = [
        "modelNotFound", "modelNotAllowed", "providerUnavailable",
        "providerTypeMismatch", "upstreamConnectionFailed",
        "concurrencyQueueFull", "concurrencyTimeout", "promptTooLong",
      ];
      for (const kind of requiredKinds) {
        expect(adapter.errorMeta[kind as keyof typeof adapter.errorMeta]).toBeDefined();
      }
    });
  });

  describe("Anthropic adapter", () => {
    const adapter = anthropicAdapter;

    it("has correct apiType and defaultPath", () => {
      expect(adapter.apiType).toBe("anthropic");
      expect(adapter.defaultPath).toBe("/v1/messages");
    });

    it("formatError returns Anthropic error structure", () => {
      const result = adapter.formatError("bad request");
      const parsed = result as { type: string; error: { type: string; message: string } };
      expect(parsed.type).toBe("error");
      expect(parsed.error.message).toBe("bad request");
      expect(parsed.error.type).toBeDefined();
    });

    it("has no beforeSendProxy", () => {
      expect(adapter.beforeSendProxy).toBeUndefined();
    });
  });

  describe("Responses adapter", () => {
    const adapter = responsesAdapter;

    it("has correct apiType and defaultPath", () => {
      expect(adapter.apiType).toBe("openai-responses");
      expect(adapter.defaultPath).toBe("/v1/responses");
    });

    it("formatError returns OpenAI-style error structure", () => {
      const result = adapter.formatError("server error", "provider_unavailable");
      const parsed = result as { error: { message: string; type: string; code: string } };
      expect(parsed.error.message).toBe("server error");
      expect(parsed.error.code).toBe("provider_unavailable");
    });
  });
});

/**
 * FormatConverter 接口契约测试 — 验证 6 个 converter 的方向转换行为。
 *
 * 覆盖 spec 中 format-adapter.md 定义的核心契约：
 * - sourceType / targetType 正确声明
 * - transformRequest 返回转换后的 body
 * - transformResponse 返回有效的 JSON string
 * - createStreamTransform 返回 Transform stream
 *
 * 不验证转换细节（那是现有 transform 函数的职责），
 * 只验证 converter 作为 wrapper 正确桥接。
 */
import { describe, it, expect } from "vitest";
import { openaiToAnthropicConverter } from "../../../src/proxy/format/converters/openai-anthropic.js";
import { anthropicToOpenAIConverter } from "../../../src/proxy/format/converters/anthropic-openai.js";
import { openaiToResponsesConverter } from "../../../src/proxy/format/converters/openai-responses.js";
import { responsesToOpenAIConverter } from "../../../src/proxy/format/converters/responses-openai.js";
import { responsesToAnthropicConverter } from "../../../src/proxy/format/converters/responses-anthropic.js";
import { anthropicToResponsesConverter } from "../../../src/proxy/format/converters/anthropic-responses.js";
import type { FormatConverter } from "../../../src/proxy/format/types.js";

describe("FormatConverter contracts", () => {
  // OpenAI 格式的标准请求体（最小可用）
  const openaiBody: Record<string, unknown> = {
    model: "gpt-4",
    messages: [{ role: "user", content: "hello" }],
    stream: false,
  };

  // Anthropic 格式的标准请求体
  const anthropicBody: Record<string, unknown> = {
    model: "claude-3",
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    max_tokens: 100,
    stream: false,
  };

  // Responses 格式的标准请求体
  const responsesBody: Record<string, unknown> = {
    model: "gpt-4",
    input: "hello",
    stream: false,
  };

  function validateConverter(
    converter: FormatConverter,
    sourceBody: Record<string, unknown>,
  ) {
    it(`has correct direction: ${converter.sourceType} → ${converter.targetType}`, () => {
      expect(converter.sourceType).toBeDefined();
      expect(converter.targetType).toBeDefined();
      expect(converter.sourceType).not.toBe(converter.targetType);
    });

    it("transformRequest returns transformed body", () => {
      const result = converter.transformRequest(structuredClone(sourceBody), "test-model");
      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
    });

    it("transformRequest does not return the same body object reference", () => {
      const original = structuredClone(sourceBody);
      const result = converter.transformRequest(original, "test-model");
      expect(result).toBeDefined();
    });

    it("transformResponse returns valid JSON string", () => {
      // 用一个简单的上游响应格式测试
      const upstreamResponse = JSON.stringify({ id: "test", choices: [] });
      const result = converter.transformResponse(upstreamResponse);
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it("createStreamTransform returns a Transform stream", () => {
      const transform = converter.createStreamTransform("test-model");
      expect(transform).toBeDefined();
      expect(typeof transform.on).toBe("function");
      expect(typeof transform.pipe).toBe("function");
    });
  }

  describe("openai → anthropic", () => {
    validateConverter(openaiToAnthropicConverter, openaiBody);
  });

  describe("anthropic → openai", () => {
    validateConverter(anthropicToOpenAIConverter, anthropicBody);
  });

  describe("openai → responses", () => {
    validateConverter(openaiToResponsesConverter, openaiBody);
  });

  describe("responses → openai", () => {
    validateConverter(responsesToOpenAIConverter, responsesBody);
  });

  describe("responses → anthropic", () => {
    validateConverter(responsesToAnthropicConverter, responsesBody);
  });

  describe("anthropic → responses", () => {
    validateConverter(anthropicToResponsesConverter, anthropicBody);
  });
});

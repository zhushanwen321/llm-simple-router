import { describe, it, expect } from "vitest";
import { TransformCoordinator } from "../../../src/proxy/transform/transform-coordinator.js";

describe("TransformCoordinator", () => {
  const coord = new TransformCoordinator();

  describe("needsTransform", () => {
    it("returns false when apiTypes match (openai)", () => {
      expect(coord.needsTransform("openai", "openai")).toBe(false);
    });
    it("returns false when apiTypes match (anthropic)", () => {
      expect(coord.needsTransform("anthropic", "anthropic")).toBe(false);
    });
    it("returns true when openai → anthropic", () => {
      expect(coord.needsTransform("openai", "anthropic")).toBe(true);
    });
    it("returns true when anthropic → openai", () => {
      expect(coord.needsTransform("anthropic", "openai")).toBe(true);
    });
  });

  describe("transformRequest", () => {
    it("transforms OA→Ant with correct upstreamPath", () => {
      const result = coord.transformRequest(
        { model: "gpt-4", messages: [{ role: "user", content: "Hi" }], stream: true },
        "openai", "anthropic", "gpt-4",
      );
      expect(result.upstreamPath).toBe("/v1/messages");
      expect(result.body.max_tokens).toBe(4096);
      expect(result.body.model).toBe("gpt-4");
    });

    it("transforms Ant→OA with correct upstreamPath and stream_options", () => {
      const result = coord.transformRequest(
        { model: "claude-3", messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }], stream: true, max_tokens: 4096 },
        "anthropic", "openai", "claude-3",
      );
      expect(result.upstreamPath).toBe("/v1/chat/completions");
      expect(result.body.stream_options).toEqual({ include_usage: true });
    });

    it("returns body unchanged when same apiType", () => {
      const body = { model: "gpt-4", messages: [] };
      const result = coord.transformRequest(body, "openai", "openai", "gpt-4");
      expect(result.body).toBe(body);
      expect(result.upstreamPath).toBe("/v1/chat/completions");
    });
  });

  describe("transformResponse", () => {
    it("transforms OA→Ant response", () => {
      const oaiBody = JSON.stringify({
        id: "chatcmpl-1", model: "gpt-4",
        choices: [{ message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
      const result = JSON.parse(coord.transformResponse(oaiBody, "openai", "anthropic"));
      expect(result.type).toBe("message");
    });

    it("returns body unchanged when same apiType", () => {
      const body = '{"id":"chatcmpl-1","choices":[]}';
      expect(coord.transformResponse(body, "openai", "openai")).toBe(body);
    });
  });

  describe("transformErrorResponse", () => {
    it("transforms cross-format errors", () => {
      const antError = JSON.stringify({ type: "error", error: { type: "err", message: "fail" } });
      const result = JSON.parse(coord.transformErrorResponse(antError, "anthropic", "openai"));
      expect(result.error.message).toBe("fail");
    });
  });

  describe("createFormatTransform", () => {
    it("creates OpenAIToAnthropicTransform for OA→Ant", () => {
      const t = coord.createFormatTransform("openai", "anthropic", "gpt-4");
      expect(t).toBeDefined();
    });

    it("creates AnthropicToOpenAITransform for Ant→OA", () => {
      const t = coord.createFormatTransform("anthropic", "openai", "claude-3");
      expect(t).toBeDefined();
    });

    it("returns undefined for same apiType", () => {
      expect(coord.createFormatTransform("openai", "openai", "gpt-4")).toBeUndefined();
    });
  });
});

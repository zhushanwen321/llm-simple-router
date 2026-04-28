import { describe, it, expect } from "vitest";
import { mapReasoningToThinking, mapThinkingToReasoning } from "../../../src/proxy/transform/thinking-mapper.js";

describe("thinking mapping", () => {
  describe("mapReasoningToThinking", () => {
    it("maps high effort to 32768 budget", () => {
      expect(mapReasoningToThinking({ effort: "high" })).toEqual({ type: "enabled", budget_tokens: 32768 });
    });
    it("maps medium effort to 8192 budget", () => {
      expect(mapReasoningToThinking({ effort: "medium" })).toEqual({ type: "enabled", budget_tokens: 8192 });
    });
    it("maps low effort to 1024 budget", () => {
      expect(mapReasoningToThinking({ effort: "low" })).toEqual({ type: "enabled", budget_tokens: 1024 });
    });
    it("max_tokens overrides effort budget", () => {
      const result = mapReasoningToThinking({ effort: "low", max_tokens: 5000 });
      expect(result.budget_tokens).toBe(5000);
    });
    it("defaults to 8192 when no effort or max_tokens", () => {
      expect(mapReasoningToThinking({})).toEqual({ type: "enabled", budget_tokens: 8192 });
    });
  });

  describe("mapThinkingToReasoning", () => {
    it("maps enabled thinking to reasoning", () => {
      expect(mapThinkingToReasoning({ type: "enabled", budget_tokens: 10000 })).toEqual({ max_tokens: 10000 });
    });
    it("returns undefined for disabled thinking", () => {
      expect(mapThinkingToReasoning({ type: "disabled" })).toBeUndefined();
    });
    it("returns undefined for undefined input", () => {
      expect(mapThinkingToReasoning(undefined)).toBeUndefined();
    });
  });
});

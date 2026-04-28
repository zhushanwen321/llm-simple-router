import { describe, it, expect } from "vitest";
import { anthropicToOpenAI, openAIToAnthropic } from "../../src/format-transformer/stop-reason.js";

describe("stop-reason mapping", () => {
  describe("anthropicToOpenAI", () => {
    it("should map end_turn to stop", () => {
      expect(anthropicToOpenAI("end_turn")).toBe("stop");
    });

    it("should map stop_sequence to stop", () => {
      expect(anthropicToOpenAI("stop_sequence")).toBe("stop");
    });

    it("should map max_tokens to length", () => {
      expect(anthropicToOpenAI("max_tokens")).toBe("length");
    });

    it("should map tool_use to tool_calls", () => {
      expect(anthropicToOpenAI("tool_use")).toBe("tool_calls");
    });

    it("should pass through unknown values unchanged", () => {
      expect(anthropicToOpenAI("unknown_reason")).toBe("unknown_reason");
      expect(anthropicToOpenAI("content_filtered")).toBe("content_filtered");
    });

    it("should return null when input is null", () => {
      expect(anthropicToOpenAI(null)).toBeNull();
    });

    it("should return undefined when input is undefined", () => {
      expect(anthropicToOpenAI(undefined)).toBeUndefined();
    });

    it("should return empty string when input is empty string", () => {
      expect(anthropicToOpenAI("")).toBe("");
    });

    it("should be case sensitive (lowercase input expected)", () => {
      expect(anthropicToOpenAI("END_TURN")).toBe("END_TURN");
      expect(anthropicToOpenAI("End_Turn")).toBe("End_Turn");
    });
  });

  describe("openAIToAnthropic", () => {
    it("should map stop to end_turn", () => {
      expect(openAIToAnthropic("stop")).toBe("end_turn");
    });

    it("should map length to max_tokens", () => {
      expect(openAIToAnthropic("length")).toBe("max_tokens");
    });

    it("should map tool_calls to tool_use", () => {
      expect(openAIToAnthropic("tool_calls")).toBe("tool_use");
    });

    it("should pass through unknown values unchanged", () => {
      expect(openAIToAnthropic("content_filter")).toBe("content_filter");
      expect(openAIToAnthropic("function_call")).toBe("function_call");
    });

    it("should return null when input is null", () => {
      expect(openAIToAnthropic(null)).toBeNull();
    });

    it("should return undefined when input is undefined", () => {
      expect(openAIToAnthropic(undefined)).toBeUndefined();
    });

    it("should return empty string when input is empty string", () => {
      expect(openAIToAnthropic("")).toBe("");
    });

    it("should be case sensitive (lowercase input expected)", () => {
      expect(openAIToAnthropic("STOP")).toBe("STOP");
      expect(openAIToAnthropic("Stop")).toBe("Stop");
    });
  });
});

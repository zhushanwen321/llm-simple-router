import { describe, it, expect } from "vitest";
import { mapFinishReasonToStopReason, mapStopReasonToFinishReason, mapUsageOA2Ant, mapUsageAnt2OA } from "../../../src/proxy/transform/usage-mapper.js";

describe("stop reason mapping", () => {
  describe("mapFinishReasonToStopReason", () => {
    it("stop → end_turn", () => expect(mapFinishReasonToStopReason("stop")).toBe("end_turn"));
    it("length → max_tokens", () => expect(mapFinishReasonToStopReason("length")).toBe("max_tokens"));
    it("tool_calls → tool_use", () => expect(mapFinishReasonToStopReason("tool_calls")).toBe("tool_use"));
    it("unknown → end_turn", () => expect(mapFinishReasonToStopReason("content_filter")).toBe("end_turn"));
  });
  describe("mapStopReasonToFinishReason", () => {
    it("end_turn → stop", () => expect(mapStopReasonToFinishReason("end_turn")).toBe("stop"));
    it("max_tokens → length", () => expect(mapStopReasonToFinishReason("max_tokens")).toBe("length"));
    it("stop_sequence → stop", () => expect(mapStopReasonToFinishReason("stop_sequence")).toBe("stop"));
    it("tool_use → tool_calls", () => expect(mapStopReasonToFinishReason("tool_use")).toBe("tool_calls"));
    it("unknown → stop", () => expect(mapStopReasonToFinishReason("unknown")).toBe("stop"));
  });
});

describe("usage mapping", () => {
  describe("mapUsageOA2Ant", () => {
    it("maps prompt/completion tokens", () => {
      const result = mapUsageOA2Ant({ prompt_tokens: 10, completion_tokens: 20 });
      expect(result).toEqual({ input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    });
    it("maps cached tokens from prompt_tokens_details", () => {
      const result = mapUsageOA2Ant({ prompt_tokens: 10, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 5 } });
      expect(result.cache_read_input_tokens).toBe(5);
    });
    it("maps cached_write_tokens", () => {
      const result = mapUsageOA2Ant({ prompt_tokens: 10, completion_tokens: 20, prompt_tokens_details: { cached_write_tokens: 3 } });
      expect(result.cache_creation_input_tokens).toBe(3);
    });
    it("returns zeros for undefined", () => {
      const result = mapUsageOA2Ant(undefined);
      expect(result).toEqual({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    });
  });
  describe("mapUsageAnt2OA", () => {
    it("maps input/output tokens", () => {
      const result = mapUsageAnt2OA({ input_tokens: 10, output_tokens: 20 });
      expect(result.prompt_tokens).toBe(10);
      expect(result.completion_tokens).toBe(20);
      expect(result.total_tokens).toBe(30);
    });
    it("includes cache in prompt_tokens", () => {
      const result = mapUsageAnt2OA({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 });
      expect(result.prompt_tokens).toBe(13);
    });
    it("includes cache_creation in prompt_tokens", () => {
      const result = mapUsageAnt2OA({ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2 });
      expect(result.prompt_tokens).toBe(12);
    });
    it("returns zeros for undefined", () => {
      const result = mapUsageAnt2OA(undefined);
      expect(result).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    });
  });
});

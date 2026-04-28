import { describe, it, expect } from "vitest";
import { mapFinishReasonToStopReason, mapStopReasonToFinishReason } from "../../../src/proxy/transform/usage-mapper.js";

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

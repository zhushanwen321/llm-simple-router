import { describe, it, expect } from "vitest";
import { extractThinkingLevelFromRequest } from "../src/proxy/orchestration/orchestrator.js";

describe("extractThinkingLevelFromRequest", () => {
  it("OpenAI: reasoning_effort 高优先级", () => {
    const clientRequest = JSON.stringify({
      body: { reasoning_effort: "high" },
    });
    const result = extractThinkingLevelFromRequest(clientRequest, "openai");
    expect(result).toBe("high");
  });

  it("Anthropic: thinking.type", () => {
    const clientRequest = JSON.stringify({
      body: { thinking: { type: "enabled" } },
    });
    const result = extractThinkingLevelFromRequest(clientRequest, "anthropic");
    expect(result).toBe("enabled");
  });

  it("Responses API: reasoning.effort", () => {
    const clientRequest = JSON.stringify({
      body: { reasoning: { effort: "low" } },
    });
    const result = extractThinkingLevelFromRequest(clientRequest, "openai-responses");
    expect(result).toBe("low");
  });

  it("OpenAI: reasoning.effort 优先于 reasoning_effort", () => {
    const clientRequest = JSON.stringify({
      body: {
        reasoning: { effort: "medium" },
        reasoning_effort: "high",
      },
    });
    const result = extractThinkingLevelFromRequest(clientRequest, "openai");
    expect(result).toBe("medium");
  });

  it("无 thinking 参数 → off", () => {
    const clientRequest = JSON.stringify({
      body: { model: "gpt-4o" },
    });
    const result = extractThinkingLevelFromRequest(clientRequest, "openai");
    expect(result).toBe("off");
  });

  it("Anthropic: thinking.type = disabled", () => {
    const clientRequest = JSON.stringify({
      body: { thinking: { type: "disabled" } },
    });
    const result = extractThinkingLevelFromRequest(clientRequest, "anthropic");
    expect(result).toBe("disabled");
  });

  it("clientRequest 为 undefined → off", () => {
    const result = extractThinkingLevelFromRequest(undefined, "openai");
    expect(result).toBe("off");
  });

  it("clientRequest 格式错误 → off", () => {
    const result = extractThinkingLevelFromRequest("not-json", "openai");
    expect(result).toBe("off");
  });

  it("clientRequest 无 body → off", () => {
    const clientRequest = JSON.stringify({ headers: {} });
    const result = extractThinkingLevelFromRequest(clientRequest, "openai");
    expect(result).toBe("off");
  });

  it("Responses API: reasoning_effort 兜底", () => {
    const clientRequest = JSON.stringify({
      body: { reasoning_effort: "high" },
    });
    const result = extractThinkingLevelFromRequest(clientRequest, "openai-responses");
    expect(result).toBe("high");
  });

  it("Anthropic: 无 thinking 字段 → off", () => {
    const clientRequest = JSON.stringify({
      body: { model: "claude-3" },
    });
    const result = extractThinkingLevelFromRequest(clientRequest, "anthropic");
    expect(result).toBe("off");
  });
});

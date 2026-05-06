import { describe, it, expect } from "vitest";
import { getModelStreamTimeout, DEFAULT_STREAM_TIMEOUT_MS } from "../router/src/db/providers.js";

function mockProvider(models: unknown[]) {
  return { models: JSON.stringify(models) } as any;
}

describe("getModelStreamTimeout", () => {
  it("returns default when model not found", () => {
    expect(getModelStreamTimeout(mockProvider([{ id: "glm-4" }]), "glm-5.1"))
      .toBe(DEFAULT_STREAM_TIMEOUT_MS);
  });

  it("returns configured value", () => {
    expect(getModelStreamTimeout(mockProvider([
      { id: "glm-5.1", stream_timeout_ms: 120_000 },
    ]), "glm-5.1")).toBe(120_000);
  });

  it("returns default when stream_timeout_ms not set", () => {
    expect(getModelStreamTimeout(mockProvider([{ id: "glm-5.1" }]), "glm-5.1"))
      .toBe(DEFAULT_STREAM_TIMEOUT_MS);
  });

  it("handles legacy string array format", () => {
    expect(getModelStreamTimeout(mockProvider(["glm-5.1"]), "glm-5.1"))
      .toBe(DEFAULT_STREAM_TIMEOUT_MS);
  });

  it("handles empty models", () => {
    expect(getModelStreamTimeout(mockProvider([]), "glm-5.1"))
      .toBe(DEFAULT_STREAM_TIMEOUT_MS);
  });

  it("handles malformed JSON", () => {
    expect(getModelStreamTimeout({ models: "not-json" } as any, "glm-5.1"))
      .toBe(DEFAULT_STREAM_TIMEOUT_MS);
  });
});

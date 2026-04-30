import { describe, it, expect } from "vitest";
import { sanitizeToolUseId, ensureNonEmptyContent } from "../../../src/proxy/transform/sanitize.js";

describe("sanitizeToolUseId", () => {
  it("returns valid id unchanged", () => {
    expect(sanitizeToolUseId("toolu_abc123")).toBe("toolu_abc123");
  });
  it("replaces dots with underscore", () => {
    expect(sanitizeToolUseId("call.123")).toBe("call_123");
  });
  it("replaces @#$ with underscores", () => {
    expect(sanitizeToolUseId("id@#$$")).toBe("id____");
  });
  it("returns fallback for empty string", () => {
    expect(sanitizeToolUseId("")).toBe("toolu_unknown");
  });
});

describe("ensureNonEmptyContent", () => {
  it("replaces empty string content with space", () => {
    const msgs = [{ role: "user", content: "" }];
    ensureNonEmptyContent(msgs);
    expect(msgs[0].content).toBe(" ");
  });
  it("replaces null content with space", () => {
    const msgs = [{ role: "user", content: null }];
    ensureNonEmptyContent(msgs);
    expect(msgs[0].content).toBe(" ");
  });
  it("replaces empty array content with space", () => {
    const msgs = [{ role: "user", content: [] }];
    ensureNonEmptyContent(msgs);
    expect(msgs[0].content).toBe(" ");
  });
  it("does not modify non-empty string content", () => {
    const msgs = [{ role: "user", content: "hello" }];
    ensureNonEmptyContent(msgs);
    expect(msgs[0].content).toBe("hello");
  });
  it("skips assistant null content (legitimate tool_calls-only)", () => {
    const msgs = [{ role: "assistant", content: null }];
    ensureNonEmptyContent(msgs);
    expect(msgs[0].content).toBeNull();
  });
  it("does not modify non-empty array content", () => {
    const msgs = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
    ensureNonEmptyContent(msgs);
    expect(msgs[0].content).toEqual([{ type: "text", text: "hi" }]);
  });
  it("skips assistant null content (legitimate tool_calls-only message)", () => {
    const msgs = [{ role: "assistant", content: null }];
    ensureNonEmptyContent(msgs);
    expect(msgs[0].content).toBeNull();
  });
});

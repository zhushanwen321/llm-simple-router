import { describe, it, expect } from "vitest";
import { resolvePath, matchBodyMatchers } from "../../router/src/proxy/orchestration/body-matcher.js";
import type { BodyMatcher } from "../../router/src/proxy/orchestration/body-matcher.js";

describe("resolvePath", () => {
  it("resolves top-level key", () => {
    expect(resolvePath({ name: "test" }, "name")).toBe("test");
  });

  it("resolves nested path", () => {
    const obj = { error: { type: "rate_limit", message: "Too many requests" } };
    expect(resolvePath(obj, "error.type")).toBe("rate_limit");
    expect(resolvePath(obj, "error.message")).toBe("Too many requests");
  });

  it("returns undefined for missing path", () => {
    expect(resolvePath({ error: { type: "x" } }, "error.code")).toBeUndefined();
  });

  it("returns undefined for missing intermediate key", () => {
    expect(resolvePath({ data: "value" }, "error.type")).toBeUndefined();
  });

  it("returns undefined for null/undefined input", () => {
    expect(resolvePath(null, "path")).toBeUndefined();
    expect(resolvePath(undefined, "path")).toBeUndefined();
  });

  it("returns undefined for non-object input", () => {
    expect(resolvePath("string", "path")).toBeUndefined();
    expect(resolvePath(42, "path")).toBeUndefined();
  });

  it("returns undefined when intermediate value is primitive", () => {
    expect(resolvePath({ error: "string" }, "error.type")).toBeUndefined();
  });

  it("resolves deeply nested path", () => {
    const obj = { a: { b: { c: { d: "deep" } } } };
    expect(resolvePath(obj, "a.b.c.d")).toBe("deep");
  });
});

describe("matchBodyMatchers", () => {
  const body = JSON.stringify({
    error: { type: "rate_limit_error", message: "Too many requests" },
    status: 429,
  });

  it("TC-1-01: returns false on invalid JSON", () => {
    const matchers: BodyMatcher[] = [{ path: "error.type", operator: "exists" }];
    expect(matchBodyMatchers("not json", matchers)).toBe(false);
  });

  it("TC-1-02: returns true when all matchers pass (AND)", () => {
    const matchers: BodyMatcher[] = [
      { path: "error.type", operator: "equals", value: "rate_limit_error" },
      { path: "status", operator: "equals", value: "429" },
    ];
    expect(matchBodyMatchers(body, matchers)).toBe(true);
  });

  it("TC-1-03: returns false when one matcher fails", () => {
    const matchers: BodyMatcher[] = [
      { path: "error.type", operator: "equals", value: "rate_limit_error" },
      { path: "status", operator: "equals", value: "200" },
    ];
    expect(matchBodyMatchers(body, matchers)).toBe(false);
  });

  it("TC-1-04: contains operator matches substring", () => {
    const matchers: BodyMatcher[] = [
      { path: "error.message", operator: "contains", value: "Too many" },
    ];
    expect(matchBodyMatchers(body, matchers)).toBe(true);
  });

  it("TC-1-04b: contains returns false when substring not found", () => {
    const matchers: BodyMatcher[] = [
      { path: "error.message", operator: "contains", value: "not found" },
    ];
    expect(matchBodyMatchers(body, matchers)).toBe(false);
  });

  it("TC-1-05: exists operator checks key presence", () => {
    const matchers: BodyMatcher[] = [
      { path: "error.type", operator: "exists" },
    ];
    expect(matchBodyMatchers(body, matchers)).toBe(true);
  });

  it("TC-1-05b: exists returns false for missing key", () => {
    const matchers: BodyMatcher[] = [
      { path: "error.code", operator: "exists" },
    ];
    expect(matchBodyMatchers(body, matchers)).toBe(false);
  });

  it("TC-1-06: equals/returns false when path is undefined", () => {
    const matchers: BodyMatcher[] = [
      { path: "nonexistent.key", operator: "equals", value: "anything" },
    ];
    expect(matchBodyMatchers(body, matchers)).toBe(false);
  });

  it("TC-1-06b: contains returns false when path is undefined", () => {
    const matchers: BodyMatcher[] = [
      { path: "nonexistent.key", operator: "contains", value: "anything" },
    ];
    expect(matchBodyMatchers(body, matchers)).toBe(false);
  });

  it("returns true for empty matchers array", () => {
    expect(matchBodyMatchers(body, [])).toBe(true);
  });

  it("converts number to string for equals comparison", () => {
    const matchers: BodyMatcher[] = [
      { path: "status", operator: "equals", value: "429" },
    ];
    expect(matchBodyMatchers(body, matchers)).toBe(true);
  });

  it("converts number to string for contains comparison", () => {
    const matchers: BodyMatcher[] = [
      { path: "status", operator: "contains", value: "42" },
    ];
    expect(matchBodyMatchers(body, matchers)).toBe(true);
  });

  it("equals with missing value uses empty string", () => {
    const obj = JSON.stringify({ key: "" });
    const matchers: BodyMatcher[] = [
      { path: "key", operator: "equals" as const },
    ];
    expect(matchBodyMatchers(obj, matchers)).toBe(true);
  });

  it("matches boolean values via String() conversion", () => {
    const obj = JSON.stringify({ flag: true });
    const matchers: BodyMatcher[] = [
      { path: "flag", operator: "equals", value: "true" },
    ];
    expect(matchBodyMatchers(obj, matchers)).toBe(true);
  });
});

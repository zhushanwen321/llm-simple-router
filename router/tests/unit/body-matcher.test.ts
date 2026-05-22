import { describe, it, expect } from "vitest";
import { resolvePath, matchBodyMatchers, type BodyMatcher } from "../../src/proxy/orchestration/body-matcher.js";

// ============================================================
// resolvePath — 嵌套路径取值
// ============================================================

describe("resolvePath", () => {
  it("从扁平对象取值", () => {
    expect(resolvePath({ type: "error" }, "type")).toBe("error");
  });

  it("从嵌套对象取值", () => {
    expect(resolvePath({ error: { type: "rate_limit" } }, "error.type")).toBe("rate_limit");
  });

  it("三层嵌套", () => {
    expect(resolvePath({ a: { b: { c: "deep" } } }, "a.b.c")).toBe("deep");
  });

  it("中间层不存在返回 undefined", () => {
    expect(resolvePath({ a: {} }, "a.b.c")).toBe(undefined);
  });

  it("路径在第一层就断开", () => {
    expect(resolvePath({}, "missing")).toBe(undefined);
  });

  it("null/undefined 对象返回 undefined", () => {
    expect(resolvePath(null, "a")).toBe(undefined);
    expect(resolvePath(undefined, "a")).toBe(undefined);
  });

  it("非对象类型返回 undefined", () => {
    expect(resolvePath("string", "length")).toBe(undefined);
    expect(resolvePath(42, "toString")).toBe(undefined);
  });

  it("中间遇到 null 返回 undefined", () => {
    expect(resolvePath({ a: null }, "a.b")).toBe(undefined);
  });

  it("取数值类型值", () => {
    expect(resolvePath({ code: 1234 }, "code")).toBe(1234);
  });

  it("取布尔值", () => {
    expect(resolvePath({ active: true }, "active")).toBe(true);
  });
});

// ============================================================
// matchBodyMatchers — 结构化匹配
// ============================================================

describe("matchBodyMatchers", () => {
  const KIMI_429 = JSON.stringify({
    error: { type: "rate_limit_error", message: "You have reached your usage limit" },
  });

  it("equals 精确匹配字符串", () => {
    const matchers: BodyMatcher[] = [
      { path: "error.type", operator: "equals", value: "rate_limit_error" },
    ];
    expect(matchBodyMatchers(KIMI_429, matchers)).toBe(true);
  });

  it("equals 不匹配时返回 false", () => {
    const matchers: BodyMatcher[] = [
      { path: "error.type", operator: "equals", value: "wrong_type" },
    ];
    expect(matchBodyMatchers(KIMI_429, matchers)).toBe(false);
  });

  it("contains 子串匹配", () => {
    const matchers: BodyMatcher[] = [
      { path: "error.type", operator: "contains", value: "rate_limit" },
    ];
    expect(matchBodyMatchers(KIMI_429, matchers)).toBe(true);
  });

  it("contains 不包含时返回 false", () => {
    const matchers: BodyMatcher[] = [
      { path: "error.message", operator: "contains", value: "timeout" },
    ];
    expect(matchBodyMatchers(KIMI_429, matchers)).toBe(false);
  });

  it("exists 字段存在即匹配", () => {
    const matchers: BodyMatcher[] = [
      { path: "error.message", operator: "exists" },
    ];
    expect(matchBodyMatchers(KIMI_429, matchers)).toBe(true);
  });

  it("exists 字段不存在返回 false", () => {
    const matchers: BodyMatcher[] = [
      { path: "error.code", operator: "exists" },
    ];
    expect(matchBodyMatchers(KIMI_429, matchers)).toBe(false);
  });

  it("exists 忽略 value 字段", () => {
    const matchers: BodyMatcher[] = [
      { path: "error.type", operator: "exists", value: "anything" },
    ];
    expect(matchBodyMatchers(KIMI_429, matchers)).toBe(true);
  });

  it("多条件 AND：全部满足", () => {
    const matchers: BodyMatcher[] = [
      { path: "error.type", operator: "contains", value: "rate_limit" },
      { path: "error.message", operator: "contains", value: "usage" },
    ];
    expect(matchBodyMatchers(KIMI_429, matchers)).toBe(true);
  });

  it("多条件 AND：任一不满足返回 false", () => {
    const matchers: BodyMatcher[] = [
      { path: "error.type", operator: "equals", value: "rate_limit_error" },
      { path: "error.message", operator: "contains", value: "timeout" },
    ];
    expect(matchBodyMatchers(KIMI_429, matchers)).toBe(false);
  });

  it("JSON.parse 失败返回 false", () => {
    expect(matchBodyMatchers("not json at all", [
      { path: "error", operator: "exists" },
    ])).toBe(false);
  });

  it("空 matchers 数组返回 true（无约束）", () => {
    expect(matchBodyMatchers(KIMI_429, [])).toBe(true);
  });

  it("equals 匹配数值字段（toString 比较）", () => {
    const body = JSON.stringify({ error: { code: 1234 } });
    const matchers: BodyMatcher[] = [
      { path: "error.code", operator: "equals", value: "1234" },
    ];
    expect(matchBodyMatchers(body, matchers)).toBe(true);
  });

  it("contains 匹配数值字段（toString 后包含）", () => {
    const body = JSON.stringify({ error: { code: 1234 } });
    const matchers: BodyMatcher[] = [
      { path: "error.code", operator: "contains", value: "23" },
    ];
    expect(matchBodyMatchers(body, matchers)).toBe(true);
  });

  it("equals 匹配布尔字段", () => {
    const body = JSON.stringify({ active: true });
    expect(matchBodyMatchers(body, [
      { path: "active", operator: "equals", value: "true" },
    ])).toBe(true);
    expect(matchBodyMatchers(body, [
      { path: "active", operator: "equals", value: "false" },
    ])).toBe(false);
  });

  it("字段值为 null 时 exists 返回 true（null !== undefined）", () => {
    const body = JSON.stringify({ error: { type: null } });
    expect(matchBodyMatchers(body, [
      { path: "error.type", operator: "exists" },
    ])).toBe(true);
  });

  it("字段值为 null 时 equals 返回 false（null 无法 toString 匹配）", () => {
    const body = JSON.stringify({ error: { type: null } });
    expect(matchBodyMatchers(body, [
      { path: "error.type", operator: "equals", value: "null" },
    ])).toBe(false);
  });

  it("字段值为对象时 equals 返回 false", () => {
    const body = JSON.stringify({ error: { nested: true } });
    expect(matchBodyMatchers(body, [
      { path: "error", operator: "equals", value: "anything" },
    ])).toBe(false);
  });

  it("value 未提供时 fallback 为空字符串", () => {
    const body = JSON.stringify({ error: { type: "" } });
    expect(matchBodyMatchers(body, [
      { path: "error.type", operator: "equals", value: undefined },
    ])).toBe(true);
  });
});

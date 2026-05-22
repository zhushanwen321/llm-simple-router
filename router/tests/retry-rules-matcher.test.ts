import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { RetryRuleMatcher } from "../src/proxy/orchestration/retry-rules.js";

describe("RetryRuleMatcher", () => {
  let db: Database.Database;
  let matcher: RetryRuleMatcher;

  beforeEach(() => {
    db = initDatabase(":memory:");
    db.prepare("DELETE FROM retry_rules").run();
    matcher = new RetryRuleMatcher();
  });

  it("returns false when no rules loaded", () => {
    expect(matcher.test(400, "error")).toBe(false);
  });

  it("returns false when status code does not match any rule", () => {
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("r1", "rule1", 400, "error", 1, new Date().toISOString());
    matcher.load(db);
    expect(matcher.test(500, "some other body")).toBe(false);
  });

  it("returns false when status code matches but pattern does not", () => {
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("r1", "rule1", 400, "请稍后重试", 1, new Date().toISOString());
    matcher.load(db);
    expect(matcher.test(400, "not matching")).toBe(false);
  });

  it("returns true when status code and pattern both match", () => {
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("r1", "rule1", 400, "请稍后重试", 1, new Date().toISOString());
    matcher.load(db);
    expect(matcher.test(400, "网络错误，请稍后重试")).toBe(true);
  });

  it("returns true when any of multiple rules for same status code matches", () => {
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("r1", "rule1", 400, "patternA", 1, new Date().toISOString());
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("r2", "rule2", 400, "patternB", 1, new Date().toISOString());
    matcher.load(db);
    expect(matcher.test(400, "has patternB in body")).toBe(true);
    expect(matcher.test(400, "has patternA in body")).toBe(true);
    expect(matcher.test(400, "no match")).toBe(false);
  });

  it("refreshes cache after reload", () => {
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("r1", "rule1", 400, "old", 1, new Date().toISOString());
    matcher.load(db);
    expect(matcher.test(400, "old pattern")).toBe(true);

    db.prepare("DELETE FROM retry_rules").run();
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("r2", "rule2", 500, "new", 1, new Date().toISOString());
    matcher.load(db);

    expect(matcher.test(400, "old pattern")).toBe(false);
    expect(matcher.test(500, "new pattern")).toBe(true);
  });
});

// ============================================================
// Provider 隔离 (AC1)
// ============================================================

describe("RetryRuleMatcher — Provider 隔离", () => {
  let db: Database.Database;
  let matcher: RetryRuleMatcher;

  beforeEach(() => {
    db = initDatabase(":memory:");
    matcher = new RetryRuleMatcher();
  });

  /** 插入规则到 retry_rules 表 */
  function insertRule(
    id: string, name: string, statusCode: number, bodyPattern: string,
    opts: { provider_id?: string | null; body_matchers?: string | null } = {},
  ): void {
    db.prepare(
      `INSERT INTO retry_rules
        (id, name, status_code, body_pattern, is_active, created_at, retry_strategy, retry_delay_ms, max_retries, max_delay_ms, provider_id, body_matchers)
       VALUES (?, ?, ?, ?, 1, ?, 'exponential', 5000, 10, 60000, ?, ?)`,
    ).run(id, name, statusCode, bodyPattern, new Date().toISOString(), opts.provider_id ?? null, opts.body_matchers ?? null);
  }

  it("绑定规则只匹配指定 provider", () => {
    insertRule("r1", "kimi-429", 429, "rate_limit", { provider_id: "provider-kimi" });
    matcher.load(db);

    // 匹配 provider-kimi
    expect(matcher.test(429, "rate_limit", "provider-kimi")).toBe(true);
    // 不匹配 provider-deepseek
    expect(matcher.test(429, "rate_limit", "provider-deepseek")).toBe(false);
  });

  it("通用规则对所有 provider 生效", () => {
    insertRule("r1", "global-429", 429, "rate_limit");
    matcher.load(db);

    expect(matcher.test(429, "rate_limit", "provider-kimi")).toBe(true);
    expect(matcher.test(429, "rate_limit", "provider-deepseek")).toBe(true);
    expect(matcher.test(429, "rate_limit")).toBe(true);
  });

  it("绑定规则优先于通用规则", () => {
    // 通用规则：匹配任何含 rate_limit 的 body
    insertRule("r-global", "global-429", 429, "rate_limit");
    // 绑定规则：匹配 provider-kimi 但 pattern 不匹配
    insertRule("r-kimi", "kimi-429", 429, "kimi_specific_pattern", { provider_id: "provider-kimi" });
    matcher.load(db);

    // provider-kimi: 绑定规则不匹配 → fallback 到通用规则
    expect(matcher.test(429, "rate_limit", "provider-kimi")).toBe(true);
    // provider-kimi: 绑定规则匹配
    expect(matcher.test(429, "kimi_specific_pattern", "provider-kimi")).toBe(true);
  });

  it("绑定规则存在但不匹配时，fallback 到通用规则", () => {
    insertRule("r-kimi", "kimi-429", 429, "kimi_only", { provider_id: "provider-kimi" });
    insertRule("r-global", "global-429", 429, "error");
    matcher.load(db);

    // provider-kimi: 绑定规则不匹配 → fallback 通用规则匹配
    expect(matcher.test(429, "has error", "provider-kimi")).toBe(true);
    // provider-deepseek: 无绑定规则 → 直接通用规则
    expect(matcher.test(429, "has error", "provider-deepseek")).toBe(true);
  });

  it("一个 provider 可绑定多条规则，按 created_at DESC 排序", () => {
    // 后插入的 created_at 更大，但 load() 按 created_at DESC 排序
    insertRule("r1", "first-rule", 429, "pattern_a", { provider_id: "provider-x" });
    insertRule("r2", "second-rule", 429, "pattern_b", { provider_id: "provider-x" });
    matcher.load(db);

    // 两条绑定规则都能命中
    expect(matcher.test(429, "pattern_a", "provider-x")).toBe(true);
    expect(matcher.test(429, "pattern_b", "provider-x")).toBe(true);
  });

  it("match() 返回匹配到的 rule 对象", () => {
    insertRule("r1", "kimi-429", 429, "rate_limit", { provider_id: "provider-kimi" });
    matcher.load(db);

    const rule = matcher.match(429, "rate_limit", "provider-kimi");
    expect(rule).not.toBeNull();
    expect(rule!.id).toBe("r1");
    expect(rule!.provider_id).toBe("provider-kimi");
  });
});

// ============================================================
// body_matchers JSON 匹配 (AC2)
// ============================================================

describe("RetryRuleMatcher — body_matchers JSON 匹配", () => {
  let db: Database.Database;
  let matcher: RetryRuleMatcher;

  beforeEach(() => {
    db = initDatabase(":memory:");
    matcher = new RetryRuleMatcher();
  });

  function insertRule(
    id: string, name: string, statusCode: number, bodyPattern: string,
    opts: { provider_id?: string | null; body_matchers?: string | null } = {},
  ): void {
    db.prepare(
      `INSERT INTO retry_rules
        (id, name, status_code, body_pattern, is_active, created_at, retry_strategy, retry_delay_ms, max_retries, max_delay_ms, provider_id, body_matchers)
       VALUES (?, ?, ?, ?, 1, ?, 'exponential', 5000, 10, 60000, ?, ?)`,
    ).run(id, name, statusCode, bodyPattern, new Date().toISOString(), opts.provider_id ?? null, opts.body_matchers ?? null);
  }

  const KIMI_429 = JSON.stringify({
    error: { type: "rate_limit_error", message: "usage limit" },
  });

  it("有 body_matchers 时使用结构化匹配（忽略 body_pattern）", () => {
    insertRule("r1", "kimi-429", 429, "will_not_match", {
      body_matchers: JSON.stringify([{ path: "error.type", operator: "equals", value: "rate_limit_error" }]),
    });
    matcher.load(db);

    // body_pattern "will_not_match" 不匹配 body，但 body_matchers 匹配
    expect(matcher.test(429, KIMI_429)).toBe(true);
  });

  it("body_matchers 不匹配时返回 false", () => {
    insertRule("r1", "kimi-429", 429, "fallback", {
      body_matchers: JSON.stringify([{ path: "error.type", operator: "equals", value: "wrong" }]),
    });
    matcher.load(db);

    // body_matchers 不匹配，不会 fallback 到 body_pattern
    expect(matcher.test(429, KIMI_429)).toBe(false);
  });

  it("body_matchers 为 NULL 时 fallback 到 body_pattern", () => {
    insertRule("r1", "rule-429", 429, "usage limit");
    matcher.load(db);

    expect(matcher.test(429, KIMI_429)).toBe(true);
  });

  it("body_matchers + provider_id 联合过滤", () => {
    insertRule("r1", "kimi-429", 429, "unused", {
      provider_id: "provider-kimi",
      body_matchers: JSON.stringify([{ path: "error.type", operator: "contains", value: "rate_limit" }]),
    });
    matcher.load(db);

    // 只匹配 provider-kimi
    expect(matcher.test(429, KIMI_429, "provider-kimi")).toBe(true);
    // 不匹配其他 provider
    expect(matcher.test(429, KIMI_429, "provider-ds")).toBe(false);
  });

  it("body_matchers 解析失败时 fallback 到 body_pattern", () => {
    // 存入无效 JSON
    insertRule("r1", "bad-matchers", 429, "usage", {
      body_matchers: "not-valid-json",
    });
    matcher.load(db);

    // matchers 解析失败 → null → fallback 到 pattern
    expect(matcher.test(429, KIMI_429)).toBe(true);
  });

  it("body 不是合法 JSON 且有 body_matchers → 不匹配（不 fallback）", () => {
    insertRule("r1", "json-rule", 429, "error", {
      body_matchers: JSON.stringify([{ path: "error", operator: "exists" }]),
    });
    matcher.load(db);

    // 非 JSON body → matchBodyMatchers 返回 false，不 fallback 到 pattern
    expect(matcher.test(429, "plain text error")).toBe(false);
  });

  it("多条件 AND 匹配", () => {
    insertRule("r1", "multi", 429, "unused", {
      body_matchers: JSON.stringify([
        { path: "error.type", operator: "contains", value: "rate_limit" },
        { path: "error.message", operator: "contains", value: "usage" },
      ]),
    });
    matcher.load(db);

    // 两个条件都满足
    expect(matcher.test(429, KIMI_429)).toBe(true);

    // 只满足一个条件
    const partialBody = JSON.stringify({ error: { type: "rate_limit_error", message: "timeout" } });
    expect(matcher.test(429, partialBody)).toBe(false);
  });
});

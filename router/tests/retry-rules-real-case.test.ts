import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { RetryRuleMatcher } from "../src/proxy/orchestration/retry-rules.js";

/**
 * 生产环境真实 case 复现：
 * 请求 2fae4565 上游返回 HTTP 500 + {"error":{"code":"1234","message":"网络错误...请稍后重试"}}
 * 但重试规则未命中，导致 is_retry=0。
 */
describe("RetryRuleMatcher — 生产 case 复现", () => {
  let db: Database.Database;
  let matcher: RetryRuleMatcher;

  // 真实上游响应 body（从 request_logs.upstream_response.body 提取）
  const REAL_RESPONSE_BODY = '{"error":{"code":"1234","message":"网络错误，错误id：20260521092139debf4436b746436c，请稍后重试"}}';
  const STATUS_CODE = 500;

  beforeEach(() => {
    db = initDatabase(":memory:");
    db.prepare("DELETE FROM retry_rules").run();
    matcher = new RetryRuleMatcher();
  });

  it("推荐规则原始 pattern（status_code=400 + 含 type 字段）不匹配 500 响应", () => {
    // 这是 recommended-retry-rules.json 中的原始规则
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at, retry_strategy, retry_delay_ms, max_retries, max_delay_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "r1", "ZAI 临时不可用", 400,
      '"type"\\s*:\\s*"error".*请稍后重试',
      1, new Date().toISOString(), "exponential", 5000, 10, 60000,
    );
    matcher.load(db);

    // status_code 不匹配（400 ≠ 500）
    expect(matcher.test(STATUS_CODE, REAL_RESPONSE_BODY)).toBe(false);

    // 即使传 status_code=400，body_pattern 也不匹配（没有 "type" 字段）
    expect(matcher.test(400, REAL_RESPONSE_BODY)).toBe(false);
  });

  it("AI 生成的规则（status_code=500 + code 1234）匹配 500 响应", () => {
    // 这是 AI Generate 生成的规则（id=761f7ac7，已从 DB 中删除）
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at, retry_strategy, retry_delay_ms, max_retries, max_delay_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "r2", "ZAI 网络错误（HTTP 500, code 1234）", 500,
      '"error".*"code"\\s*:\\s*"1234"',
      1, new Date().toISOString(), "exponential", 5000, 10, 60000,
    );
    matcher.load(db);

    expect(matcher.test(STATUS_CODE, REAL_RESPONSE_BODY)).toBe(true);

    const matched = matcher.match(STATUS_CODE, REAL_RESPONSE_BODY);
    expect(matched).not.toBeNull();
    expect(matched!.name).toBe("ZAI 网络错误（HTTP 500, code 1234）");
    expect(matched!.status_code).toBe(500);
  });

  it("修改后的规则（status_code=500 + 放宽 pattern）匹配 500 响应", () => {
    // 这是 2d3121b8 被修改后的状态：status_code 从 400→500，body_pattern 去掉了 "type" 前缀
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at, retry_strategy, retry_delay_ms, max_retries, max_delay_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "r3", "ZAI 临时不可用（HTTP 500）", 500,
      '"error".*请稍后重试',
      1, new Date().toISOString(), "exponential", 5000, 10, 60000,
    );
    matcher.load(db);

    expect(matcher.test(STATUS_CODE, REAL_RESPONSE_BODY)).toBe(true);

    const matched = matcher.match(STATUS_CODE, REAL_RESPONSE_BODY);
    expect(matched).not.toBeNull();
    expect(matched!.name).toBe("ZAI 临时不可用（HTTP 500）");
  });

  it("只有 status_code=400 的规则时，500 响应不触发任何重试", () => {
    // 模拟 01:21:41 时刻：只有原始推荐规则（全部 status_code=400）
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at, retry_strategy, retry_delay_ms, max_retries, max_delay_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "r4", "ZAI 网络错误 (code 1234)", 400,
      '"type"\\s*:\\s*"error".*"code"\\s*:\\s*"1234"',
      1, new Date().toISOString(), "exponential", 5000, 10, 60000,
    );
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at, retry_strategy, retry_delay_ms, max_retries, max_delay_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "r5", "ZAI 临时不可用", 400,
      '"type"\\s*:\\s*"error".*请稍后重试',
      1, new Date().toISOString(), "exponential", 5000, 10, 60000,
    );
    matcher.load(db);

    // 没有 status_code=500 的规则，cache.get(500) 返回 undefined
    expect(matcher.test(STATUS_CODE, REAL_RESPONSE_BODY)).toBe(false);
    expect(matcher.match(STATUS_CODE, REAL_RESPONSE_BODY)).toBeNull();
  });

  it("AI 规则被删除后、修改后的规则生效前，500 响应不触发重试", () => {
    // 模拟：AI 规则创建后又被删除，旧规则 status_code 还是 400
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at, retry_strategy, retry_delay_ms, max_retries, max_delay_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "r6", "ZAI 临时不可用", 400,
      '"type"\\s*:\\s*"error".*请稍后重试',
      1, new Date().toISOString(), "exponential", 5000, 10, 60000,
    );
    matcher.load(db);

    expect(matcher.test(STATUS_CODE, REAL_RESPONSE_BODY)).toBe(false);

    // 现在模拟：AI 规则被创建（status_code=500）
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at, retry_strategy, retry_delay_ms, max_retries, max_delay_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "r7", "ZAI 网络错误（HTTP 500, code 1234）", 500,
      '"error".*"code"\\s*:\\s*"1234"',
      1, new Date().toISOString(), "exponential", 5000, 10, 60000,
    );
    // 关键：模拟 matcher.load() 被调用（即 refreshRetryRules 成功）
    matcher.load(db);

    // 现在应该匹配
    expect(matcher.test(STATUS_CODE, REAL_RESPONSE_BODY)).toBe(true);

    // 模拟：AI 规则被删除（用户觉得和修改后的规则重复）
    db.prepare("DELETE FROM retry_rules WHERE id = ?").run("r7");
    // 同时把旧规则的 status_code 改成 500
    db.prepare("UPDATE retry_rules SET status_code = 500, body_pattern = ? WHERE id = ?").run('"error".*请稍后重试', "r6");
    matcher.load(db);

    // 修改后的规则仍然匹配
    expect(matcher.test(STATUS_CODE, REAL_RESPONSE_BODY)).toBe(true);
  });
});

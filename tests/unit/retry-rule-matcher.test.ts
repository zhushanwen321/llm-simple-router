import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { RetryRuleMatcher } from "../../router/src/proxy/orchestration/retry-rules.js";
import { createRetryRule } from "../../router/src/db/retry-rules.js";
import { initDatabase } from "../../router/src/db/index.js";

describe("RetryRuleMatcher", () => {
  let db: Database.Database;
  let matcher: RetryRuleMatcher;

  beforeEach(() => {
    db = initDatabase(":memory:") as Database.Database;
    matcher = new RetryRuleMatcher();
  });

  describe("TC-2-01: global rule (provider_id = null)", () => {
    it("matches by status_code + body_pattern", () => {
      createRetryRule(db, {
        name: "global-429",
        status_code: 429,
        body_pattern: "rate_limit",
      });
      matcher.load(db);

      const rule = matcher.match(429, '{"error":"rate_limit exceeded"}');
      expect(rule).not.toBeNull();
      expect(rule!.name).toBe("global-429");
    });

    it("does not match different status_code", () => {
      createRetryRule(db, {
        name: "global-429",
        status_code: 429,
        body_pattern: "rate_limit",
      });
      matcher.load(db);

      expect(matcher.match(500, '{"error":"rate_limit"}')).toBeNull();
    });

    it("does not match when body_pattern does not match", () => {
      createRetryRule(db, {
        name: "global-429",
        status_code: 429,
        body_pattern: "rate_limit",
      });
      matcher.load(db);

      expect(matcher.match(429, '{"error":"server_error"}')).toBeNull();
    });
  });

  describe("TC-2-02: provider-bound rule", () => {
    it("matches with providerId", () => {
      createRetryRule(db, {
        name: "provider-a-429",
        status_code: 429,
        body_pattern: "rate_limit",
        provider_id: "provider-a",
      });
      matcher.load(db);

      const rule = matcher.match(429, '{"error":"rate_limit"}', "provider-a");
      expect(rule).not.toBeNull();
      expect(rule!.name).toBe("provider-a-429");
    });

    it("falls back to global when no provider-specific rule matches", () => {
      createRetryRule(db, {
        name: "global-429",
        status_code: 429,
        body_pattern: "rate_limit",
        provider_id: null,
      });
      createRetryRule(db, {
        name: "provider-a-429",
        status_code: 429,
        body_pattern: "server_error",
        provider_id: "provider-a",
      });
      matcher.load(db);

      // provider-b has no bound rule, should fall back to global
      const rule = matcher.match(429, '{"error":"rate_limit"}', "provider-b");
      expect(rule).not.toBeNull();
      expect(rule!.name).toBe("global-429");
    });

    it("prefers provider-bound over global", () => {
      createRetryRule(db, {
        name: "global-429",
        status_code: 429,
        body_pattern: "rate_limit",
        provider_id: null,
      });
      createRetryRule(db, {
        name: "provider-a-429",
        status_code: 429,
        body_pattern: "rate_limit",
        provider_id: "provider-a",
      });
      matcher.load(db);

      const rule = matcher.match(429, '{"error":"rate_limit"}', "provider-a");
      expect(rule).not.toBeNull();
      expect(rule!.name).toBe("provider-a-429");
    });
  });

  describe("TC-2-03: body_matchers structured matching", () => {
    it("matches with body_matchers (equals)", () => {
      createRetryRule(db, {
        name: "structured-429",
        status_code: 429,
        body_pattern: "",  // empty pattern → pattern is null
        body_matchers: JSON.stringify([
          { path: "error.type", operator: "equals", value: "rate_limit_error" },
        ]),
      });
      matcher.load(db);

      const rule = matcher.match(429, '{"error":{"type":"rate_limit_error","message":"slow down"}}');
      expect(rule).not.toBeNull();
      expect(rule!.name).toBe("structured-429");
    });

    it("does not match when body_matchers condition fails", () => {
      createRetryRule(db, {
        name: "structured-429",
        status_code: 429,
        body_pattern: "",
        body_matchers: JSON.stringify([
          { path: "error.type", operator: "equals", value: "server_error" },
        ]),
      });
      matcher.load(db);

      expect(matcher.match(429, '{"error":{"type":"rate_limit_error"}}')).toBeNull();
    });

    it("falls back to body_pattern when body_matchers is null", () => {
      createRetryRule(db, {
        name: "pattern-fallback",
        status_code: 500,
        body_pattern: "internal_error",
        body_matchers: null,
      });
      matcher.load(db);

      const rule = matcher.match(500, '{"error":"internal_error occurred"}');
      expect(rule).not.toBeNull();
      expect(rule!.name).toBe("pattern-fallback");
    });
  });

  describe("TC-2-04: inactive rules ignored", () => {
    it("does not match inactive rules", () => {
      createRetryRule(db, {
        name: "inactive-rule",
        status_code: 429,
        body_pattern: "rate_limit",
        is_active: 0,
      });
      matcher.load(db);

      expect(matcher.match(429, '{"error":"rate_limit"}')).toBeNull();
    });
  });

  describe("TC-2-05: test() method", () => {
    it("returns true when match is found", () => {
      createRetryRule(db, {
        name: "test-rule",
        status_code: 429,
        body_pattern: "rate_limit",
      });
      matcher.load(db);

      expect(matcher.test(429, '{"error":"rate_limit"}')).toBe(true);
    });

    it("returns false when no match", () => {
      createRetryRule(db, {
        name: "test-rule",
        status_code: 429,
        body_pattern: "rate_limit",
      });
      matcher.load(db);

      expect(matcher.test(500, '{"error":"rate_limit"}')).toBe(false);
    });

    it("passes providerId through", () => {
      createRetryRule(db, {
        name: "provider-rule",
        status_code: 429,
        body_pattern: "rate_limit",
        provider_id: "prov-1",
      });
      matcher.load(db);

      expect(matcher.test(429, '{"error":"rate_limit"}', "prov-1")).toBe(true);
      // No global rule, so without providerId it should fail
      expect(matcher.test(429, '{"error":"rate_limit"}')).toBe(false);
    });
  });

  describe("reload clears previous cache", () => {
    it("picks up new rules after load()", () => {
      createRetryRule(db, {
        name: "rule-1",
        status_code: 429,
        body_pattern: "rate_limit",
      });
      matcher.load(db);
      expect(matcher.match(429, '{"error":"rate_limit"}')).not.toBeNull();

      // Add new rule and reload
      createRetryRule(db, {
        name: "rule-2",
        status_code: 500,
        body_pattern: "server_error",
      });
      matcher.load(db);

      expect(matcher.match(500, '{"error":"server_error"}')).not.toBeNull();
      // Old rule still works
      expect(matcher.match(429, '{"error":"rate_limit"}')).not.toBeNull();
    });
  });

  describe("malformed body_matchers JSON", () => {
    it("treats invalid JSON as null (falls back to pattern)", () => {
      createRetryRule(db, {
        name: "malformed-matchers",
        status_code: 429,
        body_pattern: "rate_limit",
        body_matchers: "not-valid-json{",
      });
      matcher.load(db);

      // body_matchers is null (parse failed), should fall back to body_pattern
      const rule = matcher.match(429, '{"error":"rate_limit"}');
      expect(rule).not.toBeNull();
      expect(rule!.name).toBe("malformed-matchers");
    });
  });
});

import Database from "better-sqlite3";
import { getActiveRetryRules, type RetryRule } from "../../db/retry-rules.js";
import type { BodyMatcher } from "./body-matcher.js";
import { matchBodyMatchers } from "./body-matcher.js";

interface CachedRule {
  rule: RetryRule;
  matchers: BodyMatcher[] | null;
  pattern: RegExp | null;
}

export class RetryRuleMatcher {
  /** Key: `${providerId ?? '__global__'}:${statusCode}` */
  private cache = new Map<string, CachedRule[]>();
  private raw: RetryRule[] = [];

  load(db: Database.Database): void {
    this.raw = getActiveRetryRules(db);
    this.cache.clear();
    for (const rule of this.raw) {
      // 解析 body_matchers JSON → BodyMatcher[]
      let matchers: BodyMatcher[] | null = null;
      if (rule.body_matchers) {
        try {
          matchers = JSON.parse(rule.body_matchers) as BodyMatcher[];
        } catch {
          matchers = null;
        }
      }

      // 编译 body_pattern 为 RegExp（空字符串则跳过）
      let pattern: RegExp | null = null;
      if (rule.body_pattern) {
        pattern = new RegExp(rule.body_pattern);
      }

      const key = `${rule.provider_id ?? "__global__"}:${rule.status_code}`;
      const entries = this.cache.get(key) ?? [];
      entries.push({ rule, matchers, pattern });
      this.cache.set(key, entries);
    }
  }

  match(statusCode: number, body: string, providerId?: string): RetryRule | null {
    // 1. 查 provider 绑定规则（优先）
    if (providerId) {
      const bound = this.cache.get(`${providerId}:${statusCode}`);
      if (bound) {
        const found = this.findMatch(bound, body);
        if (found) return found;
      }
    }

    // 2. 查通用规则
    const global = this.cache.get(`__global__:${statusCode}`);
    if (global) {
      return this.findMatch(global, body);
    }

    return null;
  }

  test(statusCode: number, body: string, providerId?: string): boolean {
    return this.match(statusCode, body, providerId) !== null;
  }

  private findMatch(entries: CachedRule[], body: string): RetryRule | null {
    for (const entry of entries) {
      // 优先用结构化 matchers（如果存在），否则 fallback 到正则 pattern
      if (entry.matchers !== null) {
        if (matchBodyMatchers(body, entry.matchers)) return entry.rule;
      } else if (entry.pattern) {
        if (entry.pattern.test(body)) return entry.rule;
      }
    }
    return null;
  }
}

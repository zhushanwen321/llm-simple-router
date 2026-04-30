import Database from "better-sqlite3";
import { getActiveRetryRules, type RetryRule } from "../../db/retry-rules.js";

export class RetryRuleMatcher {
  private cache = new Map<number, { rule: RetryRule; pattern: RegExp }[]>();
  private raw: RetryRule[] = [];

  load(db: Database.Database): void {
    this.raw = getActiveRetryRules(db);
    this.cache.clear();
    for (const rule of this.raw) {
      const entries = this.cache.get(rule.status_code) ?? [];
      entries.push({ rule, pattern: new RegExp(rule.body_pattern) });
      this.cache.set(rule.status_code, entries);
    }
  }

  match(statusCode: number, body: string): RetryRule | null {
    const entries = this.cache.get(statusCode);
    if (!entries) return null;
    for (const { rule, pattern } of entries) {
      if (pattern.test(body)) return rule;
    }
    return null;
  }

  test(statusCode: number, body: string): boolean {
    return this.match(statusCode, body) !== null;
  }
}

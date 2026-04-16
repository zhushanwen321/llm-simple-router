import Database from "better-sqlite3";
import { getActiveRetryRules, type RetryRule } from "../db/index.js";

export class RetryRuleMatcher {
  private cache = new Map<number, RegExp[]>();
  private raw: RetryRule[] = [];

  load(db: Database.Database): void {
    this.raw = getActiveRetryRules(db);
    this.cache.clear();
    for (const rule of this.raw) {
      const patterns = this.cache.get(rule.status_code) ?? [];
      patterns.push(new RegExp(rule.body_pattern));
      this.cache.set(rule.status_code, patterns);
    }
  }

  test(statusCode: number, body: string): boolean {
    const patterns = this.cache.get(statusCode);
    if (!patterns) return false;
    return patterns.some((re) => re.test(body));
  }
}

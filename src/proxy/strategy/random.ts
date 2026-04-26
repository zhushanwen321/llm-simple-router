import type { MappingStrategy, ResolveContext, Target } from "./types.js";
import { isTargetsRule, filterExcluded } from "./targets-rule.js";

export class RandomStrategy implements MappingStrategy {
  select(rule: unknown, context: ResolveContext): Target | undefined {
    if (!isTargetsRule(rule)) return undefined;

    const filtered = filterExcluded(rule.targets, context.excludeTargets);
    if (filtered.length === 0) return undefined;

    return filtered[Math.floor(Math.random() * filtered.length)];
  }
}

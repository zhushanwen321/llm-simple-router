import type { MappingStrategy, ResolveContext, Target } from "./types.js";
import { isTargetsRule, filterExcluded } from "./targets-rule.js";

export class RoundRobinStrategy implements MappingStrategy {
  private indexMap = new Map<string, number>();

  select(rule: unknown, context: ResolveContext, clientModel?: string): Target | undefined {
    if (!isTargetsRule(rule)) return undefined;

    const key = clientModel ?? JSON.stringify(rule);
    const filtered = filterExcluded(rule.targets, context.excludeTargets);
    if (filtered.length === 0) return undefined;

    const lastIndex = this.indexMap.get(key) ?? -1;
    const nextIndex = (lastIndex + 1) % filtered.length;
    this.indexMap.set(key, nextIndex);
    return filtered[nextIndex];
  }
}

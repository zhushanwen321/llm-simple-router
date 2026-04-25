import type { MappingStrategy, ResolveContext, Target } from "./types.js";
import { isTargetsRule, filterExcluded } from "./targets-rule.js";

export class FailoverStrategy implements MappingStrategy {
  select(rule: unknown, context: ResolveContext): Target | undefined {
    if (!isTargetsRule(rule)) return undefined;

    return filterExcluded(rule.targets, context.excludeTargets)[0];
  }
}

import type { MappingStrategy, ResolveContext, Target } from "./types.js";

interface TargetsRule {
  targets: Target[];
}

function isTarget(value: unknown): value is Target {
  return (
    typeof value === "object" &&
    value !== null &&
    "backend_model" in value &&
    typeof (value as Target).backend_model === "string" &&
    "provider_id" in value &&
    typeof (value as Target).provider_id === "string"
  );
}

function isTargetsRule(value: unknown): value is TargetsRule {
  if (typeof value !== "object" || value === null) return false;
  const r = value as TargetsRule;
  return Array.isArray(r.targets) && r.targets.every(isTarget);
}

export class FailoverStrategy implements MappingStrategy {
  select(rule: unknown, context: ResolveContext): Target | undefined {
    if (!isTargetsRule(rule)) return undefined;

    for (const t of rule.targets) {
      const excluded = context.excludeTargets?.some(
        (e) => e.backend_model === t.backend_model && e.provider_id === t.provider_id
      );
      if (!excluded) return t;
    }
    return undefined;
  }
}

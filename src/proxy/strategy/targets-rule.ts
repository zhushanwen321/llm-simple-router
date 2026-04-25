import type { Target } from "./types.js";

interface TargetsRule {
  targets: Target[];
}

export function isTarget(value: unknown): value is Target {
  return (
    typeof value === "object" &&
    value !== null &&
    "backend_model" in value &&
    typeof (value as Target).backend_model === "string" &&
    "provider_id" in value &&
    typeof (value as Target).provider_id === "string"
  );
}

export function isTargetsRule(value: unknown): value is TargetsRule {
  if (typeof value !== "object" || value === null) return false;
  const r = value as TargetsRule;
  return Array.isArray(r.targets) && r.targets.every(isTarget);
}

export function filterExcluded(targets: Target[], excludeTargets?: Target[]): Target[] {
  if (!excludeTargets || excludeTargets.length === 0) return targets;
  return targets.filter(
    (t) => !excludeTargets.some(
      (e) => e.backend_model === t.backend_model && e.provider_id === t.provider_id,
    ),
  );
}

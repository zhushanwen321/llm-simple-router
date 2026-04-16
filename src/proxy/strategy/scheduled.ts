import type { MappingStrategy, ResolveContext, Target } from "./types.js";

interface TimeWindow {
  start: string;
  end: string;
  target: Target;
}

interface ScheduledRule {
  default?: Target;
  windows?: TimeWindow[];
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

function isTimeWindow(value: unknown): value is TimeWindow {
  return (
    typeof value === "object" &&
    value !== null &&
    "start" in value &&
    typeof (value as TimeWindow).start === "string" &&
    "end" in value &&
    typeof (value as TimeWindow).end === "string" &&
    "target" in value &&
    isTarget((value as TimeWindow).target)
  );
}

function isScheduledRule(value: unknown): value is ScheduledRule {
  return (
    typeof value === "object" &&
    value !== null &&
    (!(value as ScheduledRule).default || isTarget((value as ScheduledRule).default)) &&
    (!(value as ScheduledRule).windows || Array.isArray((value as ScheduledRule).windows))
  );
}

function timeMatches(now: string, start: string, end: string): boolean {
  if (start > end) {
    return now >= start || now <= end;
  }
  return now >= start && now <= end;
}

export class ScheduledStrategy implements MappingStrategy {
  select(rule: unknown, context: ResolveContext): Target | undefined {
    if (!isScheduledRule(rule)) {
      return undefined;
    }

    const scheduledRule = rule as ScheduledRule;
    const now = context.now.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    if (scheduledRule.windows) {
      for (const window of scheduledRule.windows) {
        if (!isTimeWindow(window)) {
          continue;
        }
        if (timeMatches(now, window.start, window.end)) {
          return window.target;
        }
      }
    }

    return scheduledRule.default;
  }
}

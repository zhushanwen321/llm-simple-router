import Database from "better-sqlite3";
import type { Target, ResolveContext, ResolveResult, ConcurrencyOverride } from "./types.js";
import { getMappingGroup, getActiveProviderByName, getActiveProvidersWithModels, getActiveSchedulesForGroup } from "../db/index.js";
import type { Schedule } from "../db/schedules.js";

// ---------- Type guards ----------

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

// ---------- Rule parsing helpers ----------

/** 从 mapping group 的 rule JSON 中提取 targets 数组 */
function parseTargets(ruleJson: unknown): Target[] {
  if (typeof ruleJson !== "object" || ruleJson === null) return [];
  const rule = ruleJson as Record<string, unknown>;
  const targets: Target[] = [];
  if (Array.isArray(rule.targets)) {
    for (const t of rule.targets) {
      if (isTarget(t)) targets.push(t);
    }
  }
  return targets;
}

/** 从 schedule 的 mapping_rule JSON 中提取 targets 数组 */
function parseScheduleTargets(mappingRule: string): Target[] {
  try {
    const parsed = JSON.parse(mappingRule);
    return parseTargets(parsed);
  } catch {
    return [];
  }
}

/** 从 schedule 的 concurrency_rule JSON 中解析并发覆盖配置 */
function parseConcurrencyRule(concurrencyRule: string | null): ConcurrencyOverride | undefined {
  if (!concurrencyRule) return undefined;
  try {
    const parsed = JSON.parse(concurrencyRule);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const override: ConcurrencyOverride = {};
    if (typeof parsed.max_concurrency === "number") override.max_concurrency = parsed.max_concurrency;
    if (typeof parsed.queue_timeout_ms === "number") override.queue_timeout_ms = parsed.queue_timeout_ms;
    if (typeof parsed.max_queue_size === "number") override.max_queue_size = parsed.max_queue_size;
    return Object.keys(override).length > 0 ? override : undefined;
  } catch {
    return undefined;
  }
}

/** 过滤掉被排除的 targets（failover 循环中已尝试过的） */
function filterExcluded(targets: Target[], excludeTargets: Target[] | undefined): Target[] {
  if (!excludeTargets || excludeTargets.length === 0) return targets;
  return targets.filter(t =>
    !excludeTargets.some(e =>
      e.backend_model === t.backend_model && e.provider_id === t.provider_id,
    ),
  );
}

// ---------- Schedule matching ----------

/** 将 week JSON 字符串解析为 dayOfWeek 数字集合 (0=Sun ~ 6=Sat) */
function parseWeekDays(weekJson: string): Set<number> {
  try {
    const arr = JSON.parse(weekJson);
    if (!Array.isArray(arr)) return new Set([0, 1, 2, 3, 4, 5, 6]);
    return new Set(arr.filter((d: unknown) => typeof d === "number"));
  } catch {
    return new Set([0, 1, 2, 3, 4, 5, 6]);
  }
}

/**
 * 检查 schedule 是否匹配当前时间。
 * week 格式: [0,1,2,3,4,5,6]（0=周日），hour 为整数（0~24）。
 * start_hour=9, end_hour=18 表示 09:00~18:00 的区间。
 */
function scheduleMatchesNow(schedule: Schedule, now: Date): boolean {
  const days = parseWeekDays(schedule.week);
  const dayOfWeek = now.getDay();
  if (!days.has(dayOfWeek)) return false;

  const hour = now.getHours();
  // end_hour 是排他上界：start_hour=9, end_hour=18 匹配 [9, 18)
  return hour >= schedule.start_hour && hour < schedule.end_hour;
}

/**
 * 在已启用的 schedules 中找到优先级最高且匹配当前时间的。
 * schedules 已按 priority DESC 排序，所以第一个匹配的即可。
 */
function findMatchingSchedule(schedules: Schedule[], now: Date): Schedule | undefined {
  for (const schedule of schedules) {
    if (scheduleMatchesNow(schedule, now)) return schedule;
  }
  return undefined;
}

// ---------- Main resolve function ----------

export function resolveMapping(
  db: Database.Database,
  clientModel: string,
  context: ResolveContext,
): ResolveResult | null {
  // 1. provider_name/backend_model 格式：直接路由，不查 schedule
  const slashMatch = /^([a-zA-Z0-9_-]+)\/(.+)$/.exec(clientModel);
  if (slashMatch) {
    const providerName = slashMatch[1];
    const backendModel = slashMatch[2];
    const provider = getActiveProviderByName(db, providerName);
    if (provider) {
      try {
        const models: string[] = JSON.parse(provider.models);
        if (models.includes(backendModel)) {
          return { target: { backend_model: backendModel, provider_id: provider.id } };
        }
      } catch { return null }
    }
    return null;
  }

  // 2. 查找 mapping group
  const group = getMappingGroup(db, clientModel);
  if (!group) {
    // fallback: 直接查 provider 的 models 字段
    const providers = getActiveProvidersWithModels(db);
    for (const p of providers) {
      try {
        const models: string[] = JSON.parse(p.models);
        if (models.includes(clientModel)) {
          return { target: { backend_model: clientModel, provider_id: p.id } };
        }
      } catch { continue }
    }
    return null;
  }

  // 3. 解析 base targets
  let baseTargets: Target[];
  try {
    baseTargets = parseTargets(JSON.parse(group.rule));
  } catch {
    console.warn(`[mapping-resolver] Failed to parse rule for client_model '${group.client_model}'`);
    return null;
  }
  if (baseTargets.length === 0) return null;

  // 4. 查询匹配的 schedule
  const schedules = getActiveSchedulesForGroup(db, group.id);
  const matchedSchedule = findMatchingSchedule(schedules, context.now);

  // 5. 确定使用的 targets：schedule 优先，否则 base
  let activeTargets = baseTargets;
  let concurrencyOverride: ConcurrencyOverride | undefined;

  if (matchedSchedule) {
    const scheduleTargets = parseScheduleTargets(matchedSchedule.mapping_rule);
    if (scheduleTargets.length > 0) {
      activeTargets = scheduleTargets;
    }
    concurrencyOverride = parseConcurrencyRule(matchedSchedule.concurrency_rule);
  }

  // 6. 过滤已排除的 targets
  const filtered = filterExcluded(activeTargets, context.excludeTargets);
  if (filtered.length === 0) return null;

  return {
    target: filtered[0],
    concurrency_override: concurrencyOverride,
  };
}

// ---------- Exported helpers (used by proxy-handler) ----------

/** 解析 mapping group rule 中的 targets 数量，用于判断是否启用 failover */
export function countGroupTargets(ruleJson: string): number {
  try {
    return parseTargets(JSON.parse(ruleJson)).length;
  } catch {
    return 0;
  }
}

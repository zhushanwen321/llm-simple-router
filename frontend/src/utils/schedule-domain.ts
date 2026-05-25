/**
 * Schedule 领域解析层 — 封装所有 JSON parse/serialize/validate 逻辑。
 * Schedules.vue 的 UI 层只调用此模块的纯函数，不直接接触 JSON.parse/stringify。
 */
import type { ConcurrencyMode } from "@/types/concurrency";
import type { Provider } from "@/types/mapping";
import type { MappingTarget } from "@/components/quick-setup/types";
import type { Schedule, SchedulePayload } from "@/types/schedule";
import {
  buildTransformRule as buildTransformRuleCore,
  type TransformInputs,
} from "@/utils/transform-domain";
import {
  DEFAULT_CONCURRENCY_CONFIG,
  type TransformConfig,
} from "@/components/shared/types";

// ─── 常量 ───────────────────────────────────────────────

/** ISO weekday numbers (Mon=1..Fri=5) */
export const SATURDAY = 6;
export const SUNDAY = 0;
export const WEEKDAY_COUNT = 5;
export const FIRST_WEEKDAY = 1;
export const WEEKDAYS_MON_FRI = Array.from(
  { length: WEEKDAY_COUNT },
  (_, i) => i + FIRST_WEEKDAY,
);
export const WEEKEND_SIZE = 2;
export const FULL_WEEK = 7;
export const LAST_WEEKDAY = 5;
export const PAD_WIDTH = 2;

// ─── 类型 ───────────────────────────────────────────────

export interface ScheduleForm {
  name: string;
  week: number[];
  start_hour: number;
  end_hour: number;
  targets: MappingTarget[];
  concurrency_mode: ConcurrencyMode;
  max_concurrency: number;
  queue_timeout_ms: number;
  max_queue_size: number;
}

export interface ScheduleFormData {
  form: ScheduleForm;
  transform: TransformConfig;
}

export interface ParsedTarget {
  provider: string;
  model: string;
}

// ─── 默认值工厂 ─────────────────────────────────────────

export function createDefaultForm(): ScheduleForm {
  return {
    name: "",
    week: [...WEEKDAYS_MON_FRI],
    start_hour: 0,
    end_hour: 24,
    targets: [{ backend_model: "", provider_id: "" }],
    concurrency_mode: "auto" as ConcurrencyMode,
    max_concurrency: DEFAULT_CONCURRENCY_CONFIG.max_concurrency,
    queue_timeout_ms: DEFAULT_CONCURRENCY_CONFIG.queue_timeout_ms,
    max_queue_size: DEFAULT_CONCURRENCY_CONFIG.max_queue_size,
  };
}

export function createDefaultTransformConfig(): TransformConfig {
  return {
    injectHeaders: "",
    dropFields: "",
    requestDefaults: "",
  };
}

// ─── JSON 解析函数 ──────────────────────────────────────

/** 安全解析 week 字段（JSON number[]） */
export function safeParseWeek(weekStr: string): number[] {
  try {
    return JSON.parse(weekStr) as number[];
  } catch {
    return [];
  }
}

/** 智能星期标签：整周/工作日/周末返回简洁文本，否则返回 null */
export function smartWeekLabel(
  weekStr: string,
  t: (key: string) => string,
): string | null {
  const arr = safeParseWeek(weekStr).sort((a, b) => a - b);
  if (arr.length === FULL_WEEK) return t("schedules.everyDay");
  if (
    arr.length === WEEKDAY_COUNT &&
    arr[0] === FIRST_WEEKDAY &&
    arr[WEEKDAY_COUNT - 1] === LAST_WEEKDAY
  )
    return t("schedules.weekdays");
  if (arr.length === WEEKEND_SIZE && arr[0] === 0 && arr[1] === SATURDAY)
    return t("schedules.weekend");
  return null;
}

/** 解析 mapping_rule，返回可显示的 target 列表 */
export function parseTargets(
  mappingRule: string,
  providers: Provider[],
): ParsedTarget[] {
  try {
    const parsed = JSON.parse(mappingRule) as { targets?: MappingTarget[] };
    return (parsed.targets ?? []).map((tgt) => ({
      provider:
        providers.find((p) => p.id === tgt.provider_id)?.name ??
        tgt.provider_id,
      model: tgt.backend_model ?? "",
    }));
  } catch {
    return [];
  }
}

/** 格式化小时为 HH:00 */
export function formatHour(h: number): string {
  return `${h}`.padStart(PAD_WIDTH, "0") + ":00";
}

// ─── 表单构建（DB → Form）──────────────────────────────

/**
 * 将数据库 Schedule 记录解析为表单数据。
 * 返回 { data, warnings } — warnings 用于 toast 提示用户哪些字段解析失败。
 */
export function parseScheduleForEdit(
  s: Schedule,
  t: (key: string) => string,
): { data: ScheduleFormData; warnings: string[] } {
  const warnings: string[] = [];

  let targets: MappingTarget[] = [{ backend_model: "", provider_id: "" }];
  try {
    const rule = JSON.parse(s.mapping_rule) as { targets?: MappingTarget[] };
    if (rule.targets?.length) targets = rule.targets;
  } catch {
    warnings.push(t("schedules.parseRuleFailed"));
  }

  let week: number[] = [...WEEKDAYS_MON_FRI];
  try {
    week = JSON.parse(s.week);
  } catch {
    warnings.push(t("schedules.parseWeekFailed"));
  }

  let concurrencyMode: ConcurrencyMode = "auto";
  let maxConcurrency = DEFAULT_CONCURRENCY_CONFIG.max_concurrency;
  let queueTimeoutMs = DEFAULT_CONCURRENCY_CONFIG.queue_timeout_ms;
  let maxQueueSize = DEFAULT_CONCURRENCY_CONFIG.max_queue_size;
  if (s.concurrency_rule) {
    try {
      const cr = JSON.parse(s.concurrency_rule) as Record<string, unknown>;
      concurrencyMode = (cr.mode as ConcurrencyMode) || "auto";
      if (cr.max_concurrency) maxConcurrency = cr.max_concurrency as number;
      if (cr.queue_timeout_ms) queueTimeoutMs = cr.queue_timeout_ms as number;
      if (cr.max_queue_size) maxQueueSize = cr.max_queue_size as number;
    } catch {
      warnings.push(t("schedules.parseConcurrencyFailed"));
    }
  }

  let injectHeaders = "";
  let dropFields = "";
  let requestDefaults = "";
  if (s.transform_rule) {
    try {
      const tr = JSON.parse(s.transform_rule) as Record<string, unknown>;
      dropFields = ((tr.drop_fields as string[]) || []).join(", ");
      requestDefaults = tr.request_defaults
        ? JSON.stringify(tr.request_defaults)
        : "";
      injectHeaders = tr.inject_headers
        ? JSON.stringify(tr.inject_headers)
        : "";
    } catch {
      warnings.push(t("schedules.parseTransformFailed"));
    }
  }

  return {
    data: {
      form: {
        name: s.name,
        week,
        start_hour: s.start_hour,
        end_hour: s.end_hour,
        targets,
        concurrency_mode: concurrencyMode,
        max_concurrency: maxConcurrency,
        queue_timeout_ms: queueTimeoutMs,
        max_queue_size: maxQueueSize,
      },
      transform: {
        injectHeaders,
        dropFields,
        requestDefaults,
      },
    },
    warnings,
  };
}

// ─── 表单提交（Form → Payload）──────────────────────────

/** 将表单数据构建为 API payload */
export function buildSchedulePayload(
  formData: ScheduleFormData,
  groupId: string,
  transformRule: string | null,
): SchedulePayload {
  const { form } = formData;
  const mappingRule = JSON.stringify({ targets: form.targets });
  const concurrencyRule =
    form.concurrency_mode !== "none"
      ? JSON.stringify({
        mode: form.concurrency_mode,
        max_concurrency: form.max_concurrency,
        queue_timeout_ms: form.queue_timeout_ms,
        max_queue_size: form.max_queue_size,
      })
      : null;

  return {
    mapping_group_id: groupId,
    name: form.name,
    week: JSON.stringify(form.week),
    start_hour: form.start_hour,
    end_hour: form.end_hour,
    mapping_rule: mappingRule,
    concurrency_rule: concurrencyRule,
    transform_rule: transformRule,
  };
}

// ─── 表单校验 ───────────────────────────────────────────

export function validateScheduleForm(
  form: ScheduleForm,
  t: (key: string) => string,
): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!form.name.trim()) errs.name = t("schedules.form.nameRequired");
  if (form.week.length === 0) errs.week = t("schedules.form.weekRequired");
  if (form.start_hour >= form.end_hour)
    errs.time = t("schedules.form.timeInvalid");
  for (const tgt of form.targets) {
    if (!tgt.provider_id || !tgt.backend_model) {
      errs.targets = t("schedules.form.targetRequired");
      break;
    }
  }
  return errs;
}

// ─── Transform Rule 构建 ────────────────────────────────

const TRANSFORM_ERROR_KEY_MAP: Record<string, string> = {
  injectHeadersJsonError: "providers.transform.injectHeadersJsonError",
  requestDefaultsJsonError: "providers.transform.requestDefaultsJsonError",
};

/**
 * 从 transform 表单输入构建 transform_rule JSON 字符串。
 * 返回 { rule, errorKey } — errorKey 非 null 表示 JSON 解析失败，
 * 调用方据此决定是否 toast（i18n key 已映射为 providers.transform.* 前缀）。
 */
export function buildTransformRule(transform: TransformConfig): {
  rule: string | null;
  errorKey: string | null;
} {
  const inputs: TransformInputs = {
    injectHeaders: transform.injectHeaders,
    dropFields: transform.dropFields,
    requestDefaults: transform.requestDefaults,
  };
  const { rule, errorKey } = buildTransformRuleCore(inputs);
  return {
    rule,
    errorKey: errorKey ? (TRANSFORM_ERROR_KEY_MAP[errorKey] ?? errorKey) : null,
  };
}

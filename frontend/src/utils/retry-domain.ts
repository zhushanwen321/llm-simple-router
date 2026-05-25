/**
 * RetryRules 领域解析层
 *
 * 提取自 RetryRules.vue 的 body_matchers 解析/序列化、表单验证、默认值等逻辑。
 * 所有函数纯同步、无副作用，便于测试和复用。
 */

/** 单条 body matcher 条件 */
export interface BodyMatcher {
  path: string;
  operator: string;
  value: string;
}

/** 重试规则编辑表单数据 */
export interface RetryRuleForm {
  name: string;
  status_code: number;
  body_pattern: string;
  provider_id: string;
  is_active: boolean;
  retry_strategy: "fixed" | "exponential";
  retry_delay_ms: number;
  max_retries: number;
  max_delay_ms: number;
  matchMode: "regex" | "json";
  bodyMatchers: BodyMatcher[];
}

export const MIN_STATUS_CODE = 100;
export const MAX_STATUS_CODE = 599;
export const MIN_DELAY_MS = 100;
export const MAX_RETRIES = 100;

export const DEFAULT_FORM: RetryRuleForm = {
  name: "",
  status_code: 429,
  body_pattern: "",
  provider_id: "__all__",
  is_active: true,
  retry_strategy: "exponential",
  retry_delay_ms: 5000,
  max_retries: 10,
  max_delay_ms: 60000,
  matchMode: "regex",
  bodyMatchers: [],
};

/**
 * 从 JSON 字符串解析 body_matchers，失败返回空数组
 */
export function parseBodyMatchers(json: string | null): BodyMatcher[] {
  if (!json) return [];
  try {
    return JSON.parse(json) as BodyMatcher[];
  } catch {
    return [];
  }
}

/**
 * 将 body_matchers 序列化为 JSON 字符串
 * 过滤掉不完整的条目（path 为空，或非 exists 操作符但 value 为空）
 */
export function serializeBodyMatchers(matchers: BodyMatcher[]): string | null {
  const filtered = matchers.filter(
    (m) => m.path.trim() && (m.operator === "exists" || m.value.trim()),
  );
  return filtered.length > 0 ? JSON.stringify(filtered) : null;
}

/**
 * 判断 matchMode：有 body_matchers JSON 内容时为 "json"，否则为 "regex"
 */
export function detectMatchMode(
  bodyMatchersJson: string | null,
): "regex" | "json" {
  return bodyMatchersJson ? "json" : "regex";
}

/**
 * 验证重试规则表单，返回错误映射（空对象表示验证通过）
 */
export function validateRetryForm(
  form: RetryRuleForm,
  t: (key: string, params?: Record<string, unknown>) => string,
): Record<string, string> {
  const errs: Record<string, string> = {};

  if (!form.name.trim()) {
    errs.name = t("retryRules.validation.nameRequired");
  }

  const sc = Number(form.status_code);
  if (!Number.isInteger(sc) || sc < MIN_STATUS_CODE || sc > MAX_STATUS_CODE) {
    errs.status_code = t("retryRules.validation.statusCodeRange", {
      min: MIN_STATUS_CODE,
      max: MAX_STATUS_CODE,
    });
  }

  if (form.matchMode === "regex") {
    if (!form.body_pattern.trim()) {
      errs.body_pattern = t("retryRules.validation.bodyPatternRequired");
    } else {
      try {
        new RegExp(form.body_pattern);
      } catch {
        errs.body_pattern = t("retryRules.validation.bodyPatternInvalid");
      }
    }
  } else {
    const hasValid = form.bodyMatchers.some(
      (m) => m.path.trim() && (m.operator === "exists" || m.value.trim()),
    );
    if (!hasValid) {
      errs.body_matchers = t("retryRules.validation.bodyPatternRequired");
    }
  }

  const delay = Number(form.retry_delay_ms);
  if (!delay || delay < MIN_DELAY_MS) {
    errs.retry_delay_ms = t("retryRules.validation.delayMin", {
      min: MIN_DELAY_MS,
    });
  }

  const retries = Number(form.max_retries);
  if (!Number.isInteger(retries) || retries < 0 || retries > MAX_RETRIES) {
    errs.max_retries = t("retryRules.validation.retriesRange", {
      max: MAX_RETRIES,
    });
  }

  if (form.retry_strategy === "exponential") {
    const maxDelay = Number(form.max_delay_ms);
    if (!maxDelay || maxDelay < MIN_DELAY_MS) {
      errs.max_delay_ms = t("retryRules.validation.delayMin", {
        min: MIN_DELAY_MS,
      });
    }
  }

  return errs;
}

/**
 * 创建新的空表单（深拷贝 DEFAULT_FORM）
 */
export function createDefaultForm(): RetryRuleForm {
  return { ...DEFAULT_FORM, bodyMatchers: [] };
}

/**
 * 格式化 body_match 展示文本（用于表格列）
 */
export function formatBodyMatchDisplay(
  bodyMatchers: string | null | undefined,
  bodyPattern: string | undefined,
  operatorLabels: Record<string, string>,
): string {
  if (bodyMatchers) {
    const matchers = parseBodyMatchers(bodyMatchers);
    if (matchers.length > 0) {
      return matchers
        .map((m) => {
          const op = operatorLabels[m.operator] ?? m.operator;
          return m.operator === "exists"
            ? `${m.path} ${op}`
            : `${m.path} ${op} "${m.value}"`;
        })
        .join(", ");
    }
    return bodyMatchers;
  }
  return bodyPattern ?? "";
}

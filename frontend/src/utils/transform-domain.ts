/**
 * Transform Rule 领域层 — 统一 transform_rule 的构建逻辑。
 * 纯函数模块，不包含任何 UI 副作用。
 */

export interface TransformInputs {
  injectHeaders: string;
  dropFields: string;
  requestDefaults: string;
}

export type TransformErrorKey =
  | "injectHeadersJsonError"
  | "requestDefaultsJsonError";

export interface TransformBuildResult {
  /** JSON 字符串形式的 transform_rule，无输入时为 null */
  rule: string | null;
  /** 解析失败时的错误标识，调用方据此决定如何提示用户 */
  errorKey: TransformErrorKey | null;
}

/**
 * 从 3 个字符串输入构建 transform_rule JSON 字符串。
 * 所有输入为空时返回 { rule: null, errorKey: null }。
 * JSON 解析失败时返回 { rule: null, errorKey: "..." }。
 */
export function buildTransformRule(
  inputs: TransformInputs,
): TransformBuildResult {
  const { injectHeaders, dropFields, requestDefaults } = inputs;

  if (!injectHeaders.trim() && !dropFields.trim() && !requestDefaults.trim()) {
    return { rule: null, errorKey: null };
  }

  const parsedDropFields = dropFields
    ? dropFields
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    : null;

  let parsedRequestDefaults: unknown = null;
  if (requestDefaults.trim()) {
    try {
      parsedRequestDefaults = JSON.parse(requestDefaults);
    } catch {
      return { rule: null, errorKey: "requestDefaultsJsonError" };
    }
  }

  let parsedInjectHeaders: unknown = null;
  if (injectHeaders.trim()) {
    try {
      parsedInjectHeaders = JSON.parse(injectHeaders);
    } catch {
      return { rule: null, errorKey: "injectHeadersJsonError" };
    }
  }

  return {
    rule: JSON.stringify({
      drop_fields: parsedDropFields,
      request_defaults: parsedRequestDefaults,
      inject_headers: parsedInjectHeaders,
    }),
    errorKey: null,
  };
}

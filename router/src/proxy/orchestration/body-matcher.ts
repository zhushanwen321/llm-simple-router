/**
 * Body matcher — 纯函数，用于结构化匹配上游响应体。
 *
 * 与 body_pattern（正则）互补：body_matchers 通过 JSON path + 操作符
 * 做结构化匹配，避免正则的误匹配问题。
 */

export interface BodyMatcher {
  /** JSON 路径，如 "error.type"、"error.message"，按 '.' 分割逐层访问 */
  path: string;
  /** 比较操作符 */
  operator: "equals" | "contains" | "exists";
  /** equals/contains 的期望值。exists 时忽略 */
  value?: string;
}

/**
 * 从嵌套对象中按点分隔路径取值。
 * 中间层不存在 → undefined。不支持数组索引。
 */
export function resolvePath(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined || typeof obj !== "object") {
    return undefined;
  }
  const segments = path.split(".");
  let current: unknown = obj;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * JSON body 与 matchers 匹配。所有条件 AND。
 * JSON.parse 失败返回 false。
 */
export function matchBodyMatchers(body: string, matchers: BodyMatcher[]): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }

  for (const matcher of matchers) {
    const actual = resolvePath(parsed, matcher.path);

    switch (matcher.operator) {
      case "exists":
        if (actual === undefined) return false;
        break;
      case "equals": {
        if (actual === undefined) return false;
        const expected = matcher.value ?? "";
        if (typeof actual === "string") {
          if (actual !== expected) return false;
        } else if (typeof actual === "number") {
          if (actual.toString() !== expected) return false;
        } else if (typeof actual === "boolean") {
          if (actual.toString() !== expected) return false;
        } else {
          return false;
        }
        break;
      }
      case "contains": {
        if (actual === undefined) return false;
        const expected = matcher.value ?? "";
        if (typeof actual === "string") {
          if (!actual.includes(expected)) return false;
        } else if (typeof actual === "number") {
          if (!actual.toString().includes(expected)) return false;
        } else if (typeof actual === "boolean") {
          if (!actual.toString().includes(expected)) return false;
        } else {
          return false;
        }
        break;
      }
    }
  }

  return true;
}

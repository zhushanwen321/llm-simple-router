// src/proxy/log-detail-policy.ts

const HTTP_ERROR_THRESHOLD = 400;

interface RetryMatcher {
  test: (statusCode: number, body: string) => boolean;
}

/**
 * 判断一条日志是否需要保留全文详情到 DB（client_request, upstream_request, upstream_response）。
 * 两层判定：
 * 1. HTTP status_code >= 400 → 保留
 * 2. status_code < 400 但 RetryRuleMatcher 命中 → 保留
 * 3. 否则 → 只存摘要
 * 4. matcher 为 null → 保守保留（降级策略）
 */
export function shouldPreserveDetail(
  statusCode: number | null,
  responseBody: string | null,
  matcher: RetryMatcher | null,
): boolean {
  if (statusCode !== null && statusCode >= HTTP_ERROR_THRESHOLD) {
    return true;
  }
  if (!matcher) {
    return true;
  }
  if (responseBody && matcher.test(statusCode ?? 0, responseBody)) {
    return true;
  }
  return false;
}

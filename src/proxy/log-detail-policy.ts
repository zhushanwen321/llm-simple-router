// src/proxy/log-detail-policy.ts

const HTTP_ERROR_THRESHOLD = 400;

export interface RetryMatcher {
  test: (statusCode: number, body: string) => boolean;
}

/**
 * 判断一条日志是否需要保留全文详情到 DB。
 * - hasFileWriter=false 时保守保留全文（避免数据丢失）
 * - status >= 400 → 保留
 * - matcher 为 null → 保守保留
 * - matcher 命中 → 保留
 * - 否则 → 只存摘要（文件已有全文备份）
 */
export function shouldPreserveDetail(
  statusCode: number | null,
  responseBody: string | null,
  matcher: RetryMatcher | null,
  hasFileWriter: boolean = true,
): boolean {
  if (!hasFileWriter) return true;
  if (statusCode !== null && statusCode >= HTTP_ERROR_THRESHOLD) return true;
  if (!matcher) return true;
  if (responseBody && matcher.test(statusCode ?? 0, responseBody)) return true;
  return false;
}

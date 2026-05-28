// src/proxy/log-detail-policy.ts

const _HTTP_ERROR_THRESHOLD = 400;

export interface RetryMatcher {
  test: (statusCode: number, body: string) => boolean;
}

/**
 * 判断一条日志是否需要保留全文详情到 DB。
 * 始终返回 true，以便前端从 client_request 中提取 thinking level 等元数据。
 * 文件 writer 仍负责持久化备份。
 */
export function shouldPreserveDetail(
  _statusCode: number | null,
  _responseBody: string | null,
  _matcher: RetryMatcher | null,
  _hasFileWriter: boolean = true,
): boolean {
  return true;
}

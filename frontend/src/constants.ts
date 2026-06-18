export const DEFAULT_CONTEXT_WINDOW = 200_000;
export const LARGE_CONTEXT_THRESHOLD = 1_000_000;
export const DEFAULT_STREAM_TIMEOUT_MS = 300_000;
export const DEFAULT_NON_STREAM_TIMEOUT_MS = 600_000;

/** HTTP 状态码 */
export const HTTP_STATUS = {
  UNAUTHORIZED: 401,
} as const;

/** 后端 API 业务错误码 — 与 router/src/admin/api-response.ts API_CODE 保持同步 */
export const API_CODE = {
  SUCCESS: 0,
  NOT_INITIALIZED: 40103,
} as const;

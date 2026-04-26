// src/admin/api-response.ts

/** 统一信封格式 */
export interface ApiResponse<T> {
  code: number
  message: string
  data: T | null
}

/** 错误码常量 — XXYYZ 格式：前两位=HTTP 类别，后三位=业务序号 */
export const API_CODE = {
  SUCCESS: 0,
  BAD_REQUEST: 40001,
  VALIDATION_FAILED: 40002,
  INVALID_REGEX: 40003,
  WRONG_PASSWORD: 40101,
  TOKEN_INVALID: 40102,
  NOT_INITIALIZED: 40103,
  NOT_FOUND: 40401,
  CONFLICT_NAME: 40901,
  CONFLICT_REFERENCED: 40902,
  ALREADY_INITIALIZED: 40903,
  INTERNAL_ERROR: 50001,
} as const

/** HTTP status → 默认 API_CODE 映射（errorHandler 兜底用） */
const STATUS_BAD_REQUEST = 400;
const STATUS_UNAUTHORIZED = 401;
const STATUS_NOT_FOUND = 404;
const STATUS_CONFLICT = 409;

export function statusToApiCode(status: number): number {
  if (status === STATUS_BAD_REQUEST) return API_CODE.BAD_REQUEST
  if (status === STATUS_UNAUTHORIZED) return API_CODE.TOKEN_INVALID
  if (status === STATUS_NOT_FOUND) return API_CODE.NOT_FOUND
  if (status === STATUS_CONFLICT) return API_CODE.CONFLICT_NAME
  return API_CODE.INTERNAL_ERROR
}

/** 判断是否为 Admin API 路由（需要信封包装） */
export function isAdminApiResponse(url: string, contentType?: string): boolean {
  if (!url.startsWith('/admin/api/')) return false
  if (contentType?.includes('text/event-stream')) return false
  return true
}

/** 构造错误响应 */
export function apiError(code: number, message: string): ApiResponse<null> {
  return { code, message, data: null }
}

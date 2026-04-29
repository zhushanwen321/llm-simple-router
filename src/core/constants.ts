// HTTP 状态码常量 — 全局唯一来源
export const HTTP_BAD_REQUEST = 400;
export const HTTP_CREATED = 201;
export const HTTP_FORBIDDEN = 403;
export const HTTP_NOT_FOUND = 404;
export const HTTP_CONFLICT = 409;
export const HTTP_INTERNAL_ERROR = 500;
export const HTTP_BAD_GATEWAY = 502;
export const HTTP_UNPROCESSABLE_ENTITY = 422;
export const HTTP_SERVICE_UNAVAILABLE = 503;

// api_type 路由映射：proxy path → api type，用于全局 hook/errorHandler 中识别代理请求
export const PROXY_API_TYPES: Record<string, string> = {
  "/v1/chat/completions": "openai",
  "/v1/models": "openai",
  "/v1/messages": "anthropic",
};

export function getProxyApiType(url: string): string | null {
  const path = url.split("?")[0];
  return PROXY_API_TYPES[path] ?? null;
}

export const MS_PER_SECOND = 1000;

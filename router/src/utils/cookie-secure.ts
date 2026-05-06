import type { FastifyRequest } from "fastify";

/** 判断请求是否经过 HTTPS（直连或反向代理） */
export function isForwardedProtoHttps(request: FastifyRequest): boolean {
  if (request.protocol === "https") return true;
  const forwarded = request.headers["x-forwarded-proto"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value === "https";
}

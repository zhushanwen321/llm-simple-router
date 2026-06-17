import { request as httpRequestFn } from "http";
import { request as httpsRequestFn } from "https";
import type { Agent } from "http";
import type { RawHeaders } from "../types.js";

// 此模块抽离 transport 层的共享原语（URL 构建、请求构造、header 类型），
// 让 http.ts 与 stream.ts 单向依赖 stream→shared、http→shared，
// 消除 http↔stream 及 proxy-core↔http 的循环依赖。

// ===== Transport call options =====

/** 非流式/流式调用通用可选项：客户端断连信号。 */
export interface TransportCallOpts {
  signal?: AbortSignal;
}

// ===== URL building =====

const KNOWN_API_SUFFIXES = [
  "/chat/completions",
  "/messages",
  "/responses",
] as const;

/**
 * 拼接上游 URL，自动处理 base_url 已包含部分或完整 API 路径的情况。
 * 兼容：base_url 可带或不带 /v1 前缀、可含完整 endpoint，本函数只追加非重叠尾部。
 */
export function buildUpstreamUrl(baseUrl: string, upstreamPath: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");

  if (normalized.endsWith(upstreamPath)) return normalized;

  for (const suffix of KNOWN_API_SUFFIXES) {
    if (normalized.endsWith(suffix)) return normalized;
  }

  const overlap = findPathOverlap(normalized, upstreamPath);
  if (overlap.length > 0) {
    return `${normalized}${upstreamPath.slice(overlap.length)}`;
  }

  if (!upstreamPath.startsWith("/")) return `${normalized}/${upstreamPath}`;
  return `${normalized}${upstreamPath}`;
}

function findPathOverlap(baseUrl: string, upstreamPath: string): string {
  const segments = upstreamPath.split("/");
  const MIN_OVERLAP_SEGMENTS = 2;
  for (let len = segments.length - 1; len >= MIN_OVERLAP_SEGMENTS; len--) {
    const candidate = segments.slice(0, len).join("/");
    if (candidate.length > 0 && baseUrl.endsWith(candidate)) {
      return candidate;
    }
  }
  return "";
}

// ===== Request utilities =====

const HTTPS_DEFAULT_PORT = 443;
const HTTP_DEFAULT_PORT = 80;

export interface UpstreamRequestOptions {
  hostname: string;
  port: number;
  path: string;
  method: string;
  headers: Record<string, string>;
}

export const _transportInternals = {
  createUpstreamRequest(url: URL, options: UpstreamRequestOptions, agent?: Agent) {
    const opts = agent ? { ...options, agent } : options;
    return url.protocol === "https:" ? httpsRequestFn(opts) : httpRequestFn(opts);
  },
};

export function buildRequestOptions(
  url: URL,
  headers: Record<string, string>,
  method = "POST",
): UpstreamRequestOptions {
  return {
    hostname: url.hostname,
    port:
      Number(url.port) ||
      (url.protocol === "https:" ? HTTPS_DEFAULT_PORT : HTTP_DEFAULT_PORT),
    path: url.pathname,
    method,
    headers,
  };
}

export type BuildHeadersFn = (
  cliHdrs: RawHeaders,
  key: string,
  bytes?: number,
) => Record<string, string>;

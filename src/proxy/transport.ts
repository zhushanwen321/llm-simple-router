import { request as httpRequestFn } from "http";
import { request as httpsRequestFn } from "https";
import type { RawHeaders, TransportResult } from "./types.js";

// ---------- Constants ----------

const UPSTREAM_BAD_GATEWAY = 502;
const HTTPS_DEFAULT_PORT = 443;
const HTTP_DEFAULT_PORT = 80;

const SKIP_DOWNSTREAM = new Set([
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

// ---------- Request utilities ----------

export interface UpstreamRequestOptions {
  hostname: string;
  port: number;
  path: string;
  method: string;
  headers: Record<string, string>;
}

// 可变引用，方便测试替换。模块内通过此对象间接调用。
export const _transportInternals = {
  createUpstreamRequest(url: URL, options: UpstreamRequestOptions) {
    return url.protocol === "https:"
      ? httpsRequestFn(options)
      : httpRequestFn(options);
  },
};

export function createUpstreamRequest(
  url: URL,
  options: UpstreamRequestOptions,
) {
  return _transportInternals.createUpstreamRequest(url, options);
}

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

function filterHeaders(raw: RawHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value == null || SKIP_DOWNSTREAM.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

// ---------- BuildHeaders type ----------

export type BuildHeadersFn = (
  cliHdrs: RawHeaders,
  key: string,
  bytes?: number,
) => Record<string, string>;

// ---------- callNonStream ----------

export function callNonStream(
  backend: { base_url: string },
  apiKey: string,
  body: Record<string, unknown>,
  clientHeaders: RawHeaders,
  upstreamPath: string,
  buildHeaders: BuildHeadersFn,
): Promise<TransportResult> {
  return new Promise((resolve) => {
    const url = new URL(`${backend.base_url}${upstreamPath}`);
    const payload = JSON.stringify(body);
    const upstreamHeaders = buildHeaders(
      clientHeaders,
      apiKey,
      Buffer.byteLength(payload),
    );
    const options = buildRequestOptions(url, upstreamHeaders);

    const req = _transportInternals.createUpstreamRequest(url, options);

    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const statusCode = res.statusCode || UPSTREAM_BAD_GATEWAY;
        const responseBody = Buffer.concat(chunks).toString("utf-8");
        const headers = filterHeaders(res.headers as RawHeaders);

        if (statusCode >= 200 && statusCode < 300) {
          resolve({
            kind: "success",
            statusCode,
            body: responseBody,
            headers,
            sentHeaders: upstreamHeaders,
            sentBody: payload,
          });
        } else {
          resolve({
            kind: "error",
            statusCode,
            body: responseBody,
            headers,
            sentHeaders: upstreamHeaders,
            sentBody: payload,
          });
        }
      });
    });

    req.on("error", (error) => resolve({ kind: "throw", error }));
    req.write(payload);
    req.end();
  });
}

// ---------- callGet ----------

export interface GetTransportResult {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

export function callGet(
  backend: { base_url: string },
  apiKey: string,
  clientHeaders: RawHeaders,
  upstreamPath: string,
  buildHeaders: (cliHdrs: RawHeaders, key: string) => Record<string, string>,
): Promise<GetTransportResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${backend.base_url}${upstreamPath}`);
    const headers = buildHeaders(clientHeaders, apiKey);
    const options = buildRequestOptions(url, headers, "GET");

    const req = _transportInternals.createUpstreamRequest(url, options);
    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || UPSTREAM_BAD_GATEWAY,
          body: Buffer.concat(chunks).toString("utf-8"),
          headers: filterHeaders(res.headers as RawHeaders),
        });
      });
    });
    req.on("error", (err) => reject(err));
    req.end();
  });
}

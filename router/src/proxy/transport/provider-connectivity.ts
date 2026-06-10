/**
 * ProviderConnectivityChecker 的 proxy 层实现。
 * 组合 proxy 层的 callGet + buildUpstreamHeaders，通过接口暴露给 admin 层。
 */

import type { ProviderConnectivityChecker, ProviderConnectivityCheckResult } from "../../core/provider-connectivity.js";
import type { RawHeaders } from "../../core/types.js";
import { callGet } from "./http.js";
import { buildUpstreamHeaders } from "../proxy-core.js";

export class ProxyConnectivityChecker implements ProviderConnectivityChecker {
  fetchModels(
    backend: { base_url: string },
    apiKey: string,
    clientHeaders: RawHeaders,
    upstreamPath: string,
    apiType: "openai" | "openai-responses" | "anthropic",
  ): Promise<ProviderConnectivityCheckResult> {
    return callGet(
      backend,
      apiKey,
      clientHeaders,
      upstreamPath,
      (cliHdrs, key) => buildUpstreamHeaders(cliHdrs, key, undefined, apiType),
    );
  }
}

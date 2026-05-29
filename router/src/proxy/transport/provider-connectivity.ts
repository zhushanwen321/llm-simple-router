import type { IProviderConnectivityChecker, ProviderConnectivityResult } from "../../core/provider-connectivity.js";
import type { RawHeaders } from "../../core/types.js";
import { buildUpstreamHeaders } from "../proxy-core.js";
import { callGet } from "./http.js";

export class ProxyConnectivityChecker implements IProviderConnectivityChecker {
  async fetchModels(
    baseUrl: string,
    apiKey: string,
    modelsEndpoint: string,
    apiType: string,
  ): Promise<ProviderConnectivityResult> {
    const backend = { base_url: baseUrl };
    const clientHeaders: RawHeaders = {};
    const result = await callGet(
      backend,
      apiKey,
      clientHeaders,
      modelsEndpoint,
      (cliHdrs, key) => buildUpstreamHeaders(cliHdrs, key, undefined, apiType as "openai" | "openai-responses" | "anthropic"),
    );
    return { statusCode: result.statusCode, body: result.body };
  }
}

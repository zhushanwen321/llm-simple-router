import { decrypt } from "../../utils/crypto.js";
import { parseEndpoints } from "../../db/providers.js";
import type { Provider } from "../../db/providers.js";
import type { ApiType, ProviderEndpoint, ResolvedEndpoint } from "../../core/types.js";

export function resolveEndpoint(
  provider: Provider,
  clientApiType: ApiType,
  encryptionKey: string,
): ResolvedEndpoint {
  const endpoints = parseEndpoints(provider.endpoints);

  // Legacy provider without endpoints JSON: fall back to provider-level fields
  if (endpoints.length === 0) {
    const rawKey = provider.api_key;
    const decryptedKey = decrypt(rawKey, encryptionKey);
    return {
      api_type: provider.api_type,
      base_url: provider.base_url,
      upstream_path: provider.upstream_path ?? null,
      api_key: decryptedKey,
      needs_transform: provider.api_type !== clientApiType,
    };
  }

  const matched = endpoints.find((ep) => ep.api_type === clientApiType);
  let endpoint: ProviderEndpoint;
  let needsTransform: boolean;

  if (matched) {
    endpoint = matched;
    needsTransform = false;
  } else {
    endpoint = endpoints[0];
    needsTransform = endpoint.api_type !== clientApiType;
  }

  // api_key: endpoint 独立 key > provider 共享 key
  const rawKey = endpoint.api_key ?? provider.api_key;
  const decryptedKey = decrypt(rawKey, encryptionKey);

  return {
    api_type: endpoint.api_type,
    base_url: endpoint.base_url,
    upstream_path: endpoint.upstream_path ?? null,
    api_key: decryptedKey,
    needs_transform: needsTransform,
  };
}

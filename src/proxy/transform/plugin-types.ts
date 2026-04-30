/**
 * Transform Plugin 类型定义
 */

export interface PluginMatch {
  providerId?: string;
  providerName?: string;
  providerNamePattern?: string;
  apiType?: "openai" | "anthropic";
}

export interface RequestTransformContext {
  body: Record<string, unknown>;
  headers: Record<string, string>;
  sourceApiType: "openai" | "anthropic";
  targetApiType: "openai" | "anthropic";
  provider: { id: string; name: string; base_url: string; api_type: string };
}

export interface ResponseTransformContext {
  response: Record<string, unknown>;
  sourceApiType: "openai" | "anthropic";
  targetApiType: "openai" | "anthropic";
  provider: { id: string; name: string; base_url: string; api_type: string };
}

export interface TransformPlugin {
  name: string;
  version?: string;
  match: PluginMatch;
  beforeRequestTransform?(ctx: RequestTransformContext): void;
  afterRequestTransform?(ctx: RequestTransformContext): void;
  beforeResponseTransform?(ctx: ResponseTransformContext): void;
  afterResponseTransform?(ctx: ResponseTransformContext): void;
}

export function pluginMatches(
  plugin: TransformPlugin,
  provider: { id: string; name: string; api_type: string },
): boolean {
  const m = plugin.match;
  if (m.providerId && m.providerId !== provider.id) return false;
  if (m.providerName && m.providerName !== provider.name) return false;
  if (m.providerNamePattern && !new RegExp(m.providerNamePattern).test(provider.name)) return false;
  if (m.apiType && m.apiType !== provider.api_type) return false;
  return true;
}

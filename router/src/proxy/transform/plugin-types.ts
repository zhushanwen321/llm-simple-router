/**
 * Transform Plugin 类型定义
 */

/** SSE Layer 1 event for streaming interception */
export interface SSEEvent {
  /** SSE event type (e.g. "content_block_delta"), may be undefined */
  event?: string;
  /** Parsed JSON data */
  data: Record<string, unknown>;
}

/** Stream plugin context */
export interface StreamPluginContext {
  provider: { id: string; name: string; base_url: string; api_type: string };
  sourceApiType: string;
  targetApiType: string;
}

/** Error plugin context */
export interface ErrorPluginContext {
  error: Error;
  statusCode?: number;
  provider: { id: string; name: string; base_url: string; api_type: string };
  providerId?: string;
}

export interface PluginMatch {
  providerId?: string;
  providerName?: string;
  providerNamePattern?: string;
  apiType?: "openai" | "openai-responses" | "anthropic";
}

export interface RequestTransformContext {
  body: Record<string, unknown>;
  headers: Record<string, string>;
  sourceApiType: "openai" | "openai-responses" | "anthropic";
  targetApiType: "openai" | "openai-responses" | "anthropic";
  provider: { id: string; name: string; base_url: string; api_type: string };
}

export interface ResponseTransformContext {
  response: Record<string, unknown>;
  sourceApiType: "openai" | "openai-responses" | "anthropic";
  targetApiType: "openai" | "openai-responses" | "anthropic";
  provider: { id: string; name: string; base_url: string; api_type: string };
}

export interface TransformPlugin {
  name: string;
  version?: string;
  match: PluginMatch;

  // Legacy methods (kept for backward compatibility)
  beforeRequestTransform?(ctx: RequestTransformContext): void;
  afterRequestTransform?(ctx: RequestTransformContext): void;
  beforeResponseTransform?(ctx: ResponseTransformContext): void;
  afterResponseTransform?(ctx: ResponseTransformContext): void;

  // Shorthand aliases (mapped to legacy methods)
  /** Alias for beforeRequestTransform */
  beforeRequest?(ctx: RequestTransformContext): void;
  /** Alias for afterRequestTransform */
  afterRequest?(ctx: RequestTransformContext): void;
  /** Alias for beforeResponseTransform */
  beforeResponse?(ctx: ResponseTransformContext): void;
  /** Alias for afterResponseTransform */
  afterResponse?(ctx: ResponseTransformContext): void;

  /** Stream event interception (Layer 1) — return null to drop event */
  onStreamEvent?(event: SSEEvent, ctx: StreamPluginContext): SSEEvent | null;
  /** Error handling */
  onError?(ctx: ErrorPluginContext): void | Promise<void>;
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

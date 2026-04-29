/**
 * Anthropic Provider-Specific Fields (PSF)
 *
 * Preserves fields that would be lost during OA↔Ant conversion:
 * - thinking signatures (required for multi-turn extended thinking)
 * - citations
 * - redacted_thinking blocks
 * - cache usage metrics
 */

export interface AnthropicProviderMeta {
  thinking_signatures?: Array<{ index: number; signature: string }>;
  citations?: Array<{ block_index: number; citations: unknown[] }>;
  redacted_thinking?: unknown[];
  cache_usage?: {
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export function extractAnthropicMeta(
  antResponse: Record<string, unknown>,
): AnthropicProviderMeta | undefined {
  const content = antResponse.content as
    | Array<Record<string, unknown>>
    | undefined;
  if (!content) return undefined;

  const meta: AnthropicProviderMeta = {};
  let hasMeta = false;

  // thinking signatures — needed for multi-turn extended thinking
  const signatures: Array<{ index: number; signature: string }> = [];
  for (let i = 0; i < content.length; i++) {
    if (content[i].type === "thinking" && content[i].signature) {
      signatures.push({
        index: i,
        signature: content[i].signature as string,
      });
    }
  }
  if (signatures.length > 0) {
    meta.thinking_signatures = signatures;
    hasMeta = true;
  }

  // redacted_thinking blocks
  const redacted = content.filter((b) => b.type === "redacted_thinking");
  if (redacted.length > 0) {
    meta.redacted_thinking = redacted;
    hasMeta = true;
  }

  // citations
  const citations: Array<{ block_index: number; citations: unknown[] }> = [];
  for (let i = 0; i < content.length; i++) {
    if (content[i].citations) {
      citations.push({
        block_index: i,
        citations: content[i].citations as unknown[],
      });
    }
  }
  if (citations.length > 0) {
    meta.citations = citations;
    hasMeta = true;
  }

  // cache usage from top-level usage
  const usage = antResponse.usage as Record<string, unknown> | undefined;
  if (
    usage?.cache_read_input_tokens != null ||
    usage?.cache_creation_input_tokens != null
  ) {
    meta.cache_usage = {
      cache_read_input_tokens: usage.cache_read_input_tokens as
        | number
        | undefined,
      cache_creation_input_tokens: usage.cache_creation_input_tokens as
        | number
        | undefined,
    };
    hasMeta = true;
  }

  return hasMeta ? meta : undefined;
}

export function stripProviderMeta(body: Record<string, unknown>): {
  meta: AnthropicProviderMeta | undefined;
  body: Record<string, unknown>;
} {
  const pm = body.provider_meta as Record<string, unknown> | undefined;
  if (!pm) return { meta: undefined, body };
  const cleaned = { ...body };
  delete cleaned.provider_meta;
  return {
    meta: pm.anthropic as AnthropicProviderMeta | undefined,
    body: cleaned,
  };
}

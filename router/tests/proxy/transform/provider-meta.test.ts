import { describe, it, expect } from "vitest";
import {
  extractAnthropicMeta,
  stripProviderMeta,
} from "../../../src/proxy/transform/provider-meta.js";

describe("extractAnthropicMeta", () => {
  it("extracts thinking signatures", () => {
    const meta = extractAnthropicMeta({
      content: [
        { type: "thinking", thinking: "hmm", signature: "sig_abc" },
        { type: "text", text: "answer" },
        { type: "thinking", thinking: "more", signature: "sig_def" },
      ],
    });
    expect(meta?.thinking_signatures).toEqual([
      { index: 0, signature: "sig_abc" },
      { index: 2, signature: "sig_def" },
    ]);
  });

  it("extracts redacted_thinking blocks", () => {
    const redacted = { type: "redacted_thinking", data: "..." };
    const meta = extractAnthropicMeta({
      content: [redacted, { type: "text", text: "answer" }],
    });
    expect(meta?.redacted_thinking).toEqual([redacted]);
  });

  it("extracts citations", () => {
    const meta = extractAnthropicMeta({
      content: [
        { type: "text", text: "See ref", citations: [{ url: "https://example.com" }] },
      ],
    });
    expect(meta?.citations).toEqual([
      { block_index: 0, citations: [{ url: "https://example.com" }] },
    ]);
  });

  it("extracts cache usage from top-level usage", () => {
    const meta = extractAnthropicMeta({
      content: [{ type: "text", text: "hi" }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 },
    });
    expect(meta?.cache_usage).toEqual({
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 50,
    });
  });

  it("returns undefined when no PSF present", () => {
    const meta = extractAnthropicMeta({
      content: [{ type: "text", text: "hello" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    expect(meta).toBeUndefined();
  });

  it("returns undefined when content is missing", () => {
    expect(extractAnthropicMeta({})).toBeUndefined();
  });
});

describe("stripProviderMeta", () => {
  it("extracts and removes provider_meta from body", () => {
    const { meta, body } = stripProviderMeta({
      model: "gpt-4",
      messages: [],
      provider_meta: {
        anthropic: { thinking_signatures: [{ index: 0, signature: "sig_1" }] },
      },
    });
    expect(meta).toEqual({
      thinking_signatures: [{ index: 0, signature: "sig_1" }],
    });
    expect(body).toEqual({ model: "gpt-4", messages: [] });
    expect(body).not.toHaveProperty("provider_meta");
  });

  it("returns undefined meta when no provider_meta", () => {
    const { meta, body } = stripProviderMeta({ model: "gpt-4", messages: [] });
    expect(meta).toBeUndefined();
    expect(body).toEqual({ model: "gpt-4", messages: [] });
  });
});

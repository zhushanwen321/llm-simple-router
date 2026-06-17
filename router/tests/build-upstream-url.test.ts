import { describe, it, expect } from "vitest";
import { buildUpstreamUrl } from "../src/proxy/transport/shared.js";

describe("buildUpstreamUrl", () => {
  // --- Basic: clean base_url + standard upstreamPath ---
  it("concatenates clean base_url with upstream path", () => {
    expect(
      buildUpstreamUrl("https://api.openai.com", "/v1/chat/completions"),
    ).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("concatenates clean base_url with anthropic path", () => {
    expect(
      buildUpstreamUrl("https://api.anthropic.com", "/v1/messages"),
    ).toBe("https://api.anthropic.com/v1/messages");
  });

  // --- Trailing slash normalization ---
  it("strips trailing slashes from base_url", () => {
    expect(
      buildUpstreamUrl("https://api.deepseek.com/", "/v1/chat/completions"),
    ).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  it("strips multiple trailing slashes", () => {
    expect(
      buildUpstreamUrl("https://api.deepseek.com///", "/v1/chat/completions"),
    ).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  // --- Exact match: base_url already contains full upstreamPath ---
  it("returns base_url as-is when it ends with full upstreamPath", () => {
    expect(
      buildUpstreamUrl(
        "https://api.deepseek.com/v1/chat/completions",
        "/v1/chat/completions",
      ),
    ).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  it("returns base_url as-is for anthropic exact match", () => {
    expect(
      buildUpstreamUrl(
        "https://api.anthropic.com/v1/messages",
        "/v1/messages",
      ),
    ).toBe("https://api.anthropic.com/v1/messages");
  });

  // --- /v1 prefix dedup: base_url ends with /v1 ---
  it("deduplicates /v1 prefix when base_url ends with /v1", () => {
    expect(
      buildUpstreamUrl("https://api.deepseek.com/v1", "/v1/chat/completions"),
    ).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  it("deduplicates /v1 prefix for anthropic path", () => {
    expect(
      buildUpstreamUrl("https://api.anthropic.com/v1", "/v1/messages"),
    ).toBe("https://api.anthropic.com/v1/messages");
  });

  // --- Known API suffix detection ---
  it("recognizes base_url already ending with /chat/completions", () => {
    expect(
      buildUpstreamUrl(
        "https://api.example.com/chat/completions",
        "/v1/chat/completions",
      ),
    ).toBe("https://api.example.com/chat/completions");
  });

  it("recognizes base_url already ending with /messages", () => {
    expect(
      buildUpstreamUrl(
        "https://api.example.com/v1/messages",
        "/v1/chat/completions", // different path, but /messages already there
      ),
    ).toBe("https://api.example.com/v1/messages");
  });

  it("recognizes base_url already ending with /responses", () => {
    expect(
      buildUpstreamUrl(
        "https://api.example.com/v1/responses",
        "/v1/responses",
      ),
    ).toBe("https://api.example.com/v1/responses");
  });

  // --- Trailing slash + exact path match ---
  it("handles trailing slash with exact path match", () => {
    expect(
      buildUpstreamUrl(
        "https://api.deepseek.com/v1/chat/completions/",
        "/v1/chat/completions",
      ),
    ).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  // --- Custom upstream path (not standard API) ---
  it("handles custom upstream paths", () => {
    expect(
      buildUpstreamUrl(
        "https://open.bigmodel.cn/api/paas/v4",
        "/api/paas/v4/chat/completions",
      ),
    ).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
  });

  // --- /v1 without trailing slash + standard path ---
  it("handles /v1 trailing with slash in upstreamPath", () => {
    expect(
      buildUpstreamUrl("https://host/v1/", "/v1/chat/completions"),
    ).toBe("https://host/v1/chat/completions");
  });
});

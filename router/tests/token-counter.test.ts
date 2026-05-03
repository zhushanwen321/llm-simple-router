import { describe, it, expect } from "vitest";
import { countTokens, estimateInputTokens } from "../src/utils/token-counter.js";
import { encode } from "gpt-tokenizer";

describe("countTokens", () => {
  it("returns 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });

  it("returns positive count for short text", () => {
    const count = countTokens("Hello, world!");
    expect(count).toBeGreaterThan(0);
    // "Hello, world!" is typically 3-4 tokens
    expect(count).toBeLessThan(10);
  });

  it("handles unicode (Chinese) text", () => {
    const count = countTokens("你好世界");
    expect(count).toBeGreaterThan(0);
  });

  it("handles code blocks with special characters", () => {
    const code = 'function hello() {\n  console.log("Hello!");\n  return 42;\n}';
    const count = countTokens(code);
    expect(count).toBeGreaterThan(0);
  });

  it("sampling extrapolation for long text is within 20% of actual", () => {
    // Generate text > 4000 chars
    const longText = "The quick brown fox jumps over the lazy dog. ".repeat(200);
    expect(longText.length).toBeGreaterThan(4000);

    const estimated = countTokens(longText);

    // Compute actual by encoding the full text
    const actual = encode(longText).length;

    // Estimated should be within 20% of actual
    expect(estimated).toBeGreaterThan(0);
    expect(Math.abs(estimated - actual) / actual).toBeLessThan(0.2);
  });
});

describe("estimateInputTokens", () => {
  it("returns 0 for empty body", () => {
    expect(estimateInputTokens({})).toBe(0);
  });

  it("estimates tokens for OpenAI format", () => {
    const body = {
      messages: [{ role: "user", content: "Hello, how are you today?" }],
    };
    const count = estimateInputTokens(body);
    expect(count).toBeGreaterThan(0);
  });

  it("estimates tokens for Anthropic format with content array", () => {
    const body = {
      system: "You are a helpful assistant.",
      messages: [
        { role: "user", content: [{ type: "text", text: "Hello!" }] },
      ],
    };
    const count = estimateInputTokens(body);
    expect(count).toBeGreaterThan(0);
  });

  it("includes system prompt in estimation", () => {
    const bodyNoSystem = {
      messages: [{ role: "user", content: "Hi" }],
    };
    const bodyWithSystem = {
      system: "You are a very detailed assistant that provides thorough answers.",
      messages: [{ role: "user", content: "Hi" }],
    };
    expect(estimateInputTokens(bodyWithSystem)).toBeGreaterThan(
      estimateInputTokens(bodyNoSystem),
    );
  });

  it("includes OpenAI tools in estimation", () => {
    const body = {
      messages: [{ role: "user", content: "What's the weather?" }],
      tools: [
        {
          function: {
            name: "get_weather",
            description: "Get the current weather for a location",
            parameters: {
              type: "object",
              properties: { location: { type: "string" } },
            },
          },
        },
      ],
    };
    const count = estimateInputTokens(body);
    expect(count).toBeGreaterThan(3); // more than just the message
  });

  it("includes Anthropic tools in estimation", () => {
    const body = {
      messages: [{ role: "user", content: "Search for files" }],
      tools: [
        {
          name: "search_files",
          description: "Search for files by name",
          input_schema: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
      ],
    };
    const count = estimateInputTokens(body);
    expect(count).toBeGreaterThan(3);
  });

  it("handles tool_result content blocks", () => {
    const body = {
      messages: [
        { role: "user", content: "Check the weather" },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "1", name: "weather", input: { city: "Beijing" } }],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "1",
              content: "The weather in Beijing is sunny, 25°C",
            },
          ],
        },
      ],
    };
    const count = estimateInputTokens(body);
    expect(count).toBeGreaterThan(0);
  });

  it("handles string content in messages", () => {
    const body = {
      messages: [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hello there" },
      ],
    };
    const count = estimateInputTokens(body);
    expect(count).toBeGreaterThan(0);
  });

  it("handles system as array (Anthropic format)", () => {
    const body = {
      system: [{ type: "text", text: "You are a coding expert." }],
      messages: [{ role: "user", content: "Write some code" }],
    };
    const count = estimateInputTokens(body);
    expect(count).toBeGreaterThan(0);
  });
});

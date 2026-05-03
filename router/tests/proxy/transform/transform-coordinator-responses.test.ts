import { describe, it, expect } from "vitest";
import { TransformCoordinator } from "../../../src/proxy/transform/transform-coordinator.js";
import { ResponsesToAnthropicTransform } from "../../../src/proxy/transform/stream-resp2ant.js";
import { AnthropicToResponsesTransform } from "../../../src/proxy/transform/stream-ant2resp.js";
import { OpenAIToAnthropicTransform } from "../../../src/proxy/transform/stream-oa2ant.js";
import { AnthropicToOpenAITransform } from "../../../src/proxy/transform/stream-ant2oa.js";
import { ResponsesToChatBridgeTransform } from "../../../src/proxy/transform/stream-bridge-resp2chat.js";
import { ChatToResponsesBridgeTransform } from "../../../src/proxy/transform/stream-bridge-chat2resp.js";

describe("TransformCoordinator — 3×3 matrix", () => {
  const coord = new TransformCoordinator();

  // ----------------------------------------------------------------
  // needsTransform
  // ----------------------------------------------------------------
  describe("needsTransform", () => {
    it("returns false when apiTypes match (openai)", () => {
      expect(coord.needsTransform("openai", "openai")).toBe(false);
    });
    it("returns false when apiTypes match (anthropic)", () => {
      expect(coord.needsTransform("anthropic", "anthropic")).toBe(false);
    });
    it("returns false when apiTypes match (openai-responses)", () => {
      expect(coord.needsTransform("openai-responses", "openai-responses")).toBe(false);
    });
    it("returns true for all cross-format pairs", () => {
      const types = ["openai", "anthropic", "openai-responses"];
      for (const entry of types) {
        for (const provider of types) {
          if (entry !== provider) {
            expect(coord.needsTransform(entry, provider)).toBe(true);
          }
        }
      }
    });
  });

  // ----------------------------------------------------------------
  // transformRequest — identity (no transform)
  // ----------------------------------------------------------------
  describe("transformRequest — identity", () => {
    it("openai → openai: returns body unchanged", () => {
      const body = { model: "gpt-4", messages: [] };
      const result = coord.transformRequest(body, "openai", "openai", "gpt-4");
      expect(result.body).toBe(body);
      expect(result.upstreamPath).toBe("/v1/chat/completions");
    });

    it("anthropic → anthropic: returns body unchanged", () => {
      const body = { model: "claude-3", messages: [] };
      const result = coord.transformRequest(body, "anthropic", "anthropic", "claude-3");
      expect(result.body).toBe(body);
      expect(result.upstreamPath).toBe("/v1/messages");
    });

    it("openai-responses → openai-responses: returns body unchanged", () => {
      const body = { model: "gpt-4o", input: "hi" };
      const result = coord.transformRequest(body, "openai-responses", "openai-responses", "gpt-4o");
      expect(result.body).toBe(body);
      expect(result.upstreamPath).toBe("/v1/responses");
    });
  });

  // ----------------------------------------------------------------
  // transformRequest — Tier-1 (Responses ↔ Anthropic)
  // ----------------------------------------------------------------
  describe("transformRequest — Tier-1 Responses ↔ Anthropic", () => {
    it("openai-responses → anthropic: converts request", () => {
      const body = {
        model: "gpt-4o",
        input: [{ role: "user", content: "Hello" }],
        stream: true,
      };
      const result = coord.transformRequest(body, "openai-responses", "anthropic", "gpt-4o");
      expect(result.upstreamPath).toBe("/v1/messages");
      expect(result.body.model).toBe("gpt-4o");
      expect(result.body.messages).toBeDefined();
      expect(result.body.stream).toBe(true);
    });

    it("anthropic → openai-responses: converts request", () => {
      const body = {
        model: "claude-3",
        messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
        max_tokens: 1024,
        stream: true,
      };
      const result = coord.transformRequest(body, "anthropic", "openai-responses", "claude-3");
      expect(result.upstreamPath).toBe("/v1/responses");
      expect(result.body.model).toBe("claude-3");
      expect(result.body.input).toBeDefined();
    });
  });

  // ----------------------------------------------------------------
  // transformRequest — Existing (Chat ↔ Anthropic)
  // ----------------------------------------------------------------
  describe("transformRequest — Existing Chat ↔ Anthropic", () => {
    it("openai → anthropic: converts request", () => {
      const body = {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
        stream: true,
      };
      const result = coord.transformRequest(body, "openai", "anthropic", "gpt-4");
      expect(result.upstreamPath).toBe("/v1/messages");
      expect(result.body.max_tokens).toBeDefined();
    });

    it("anthropic → openai: converts request", () => {
      const body = {
        model: "claude-3",
        messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        stream: true,
        max_tokens: 4096,
      };
      const result = coord.transformRequest(body, "anthropic", "openai", "claude-3");
      expect(result.upstreamPath).toBe("/v1/chat/completions");
      expect(result.body.stream_options).toEqual({ include_usage: true });
    });
  });

  // ----------------------------------------------------------------
  // transformRequest — Bridge (Responses ↔ Chat)
  // ----------------------------------------------------------------
  describe("transformRequest — Bridge Responses ↔ Chat", () => {
    it("openai-responses → openai: converts request", () => {
      const body = {
        model: "gpt-4o",
        input: [{ role: "user", content: "Hello" }],
        stream: true,
      };
      const result = coord.transformRequest(body, "openai-responses", "openai", "gpt-4o");
      expect(result.upstreamPath).toBe("/v1/chat/completions");
      expect(result.body.model).toBe("gpt-4o");
      expect(result.body.messages).toBeDefined();
    });

    it("openai → openai-responses: converts request", () => {
      const body = {
        model: "gpt-4o",
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      };
      const result = coord.transformRequest(body, "openai", "openai-responses", "gpt-4o");
      expect(result.upstreamPath).toBe("/v1/responses");
      expect(result.body.model).toBe("gpt-4o");
      expect(result.body.input).toBeDefined();
    });
  });

  // ----------------------------------------------------------------
  // transformResponse — identity
  // ----------------------------------------------------------------
  describe("transformResponse — identity", () => {
    it("returns body unchanged when same apiType", () => {
      const body = '{"id":"test","output":[]}';
      expect(coord.transformResponse(body, "openai-responses", "openai-responses")).toBe(body);
      expect(coord.transformResponse(body, "openai", "openai")).toBe(body);
      expect(coord.transformResponse(body, "anthropic", "anthropic")).toBe(body);
    });
  });

  // ----------------------------------------------------------------
  // transformResponse — Tier-1 (Responses ↔ Anthropic)
  // ----------------------------------------------------------------
  describe("transformResponse — Tier-1 Responses ↔ Anthropic", () => {
    it("openai-responses → anthropic: converts response", () => {
      const respBody = JSON.stringify({
        id: "resp-1",
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: "Hi" }] }],
        model: "gpt-4o",
      });
      const result = JSON.parse(coord.transformResponse(respBody, "openai-responses", "anthropic"));
      expect(result.type).toBe("message");
      expect(result.content).toBeDefined();
    });

    it("anthropic → openai-responses: converts response", () => {
      const antBody = JSON.stringify({
        id: "msg-1",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hi" }],
        model: "claude-3",
        stop_reason: "end_turn",
      });
      const result = JSON.parse(coord.transformResponse(antBody, "anthropic", "openai-responses"));
      expect(result.output).toBeDefined();
    });
  });

  // ----------------------------------------------------------------
  // transformResponse — Existing (Chat ↔ Anthropic)
  // ----------------------------------------------------------------
  describe("transformResponse — Existing Chat ↔ Anthropic", () => {
    it("openai → anthropic: converts response", () => {
      const oaiBody = JSON.stringify({
        id: "chatcmpl-1",
        model: "gpt-4",
        choices: [{ message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
      const result = JSON.parse(coord.transformResponse(oaiBody, "openai", "anthropic"));
      expect(result.type).toBe("message");
    });

    it("anthropic → openai: converts response", () => {
      const antBody = JSON.stringify({
        id: "msg-1",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hi" }],
        model: "claude-3",
        stop_reason: "end_turn",
      });
      const result = JSON.parse(coord.transformResponse(antBody, "anthropic", "openai"));
      expect(result.choices).toBeDefined();
    });
  });

  // ----------------------------------------------------------------
  // transformResponse — Bridge (Responses ↔ Chat)
  // ----------------------------------------------------------------
  describe("transformResponse — Bridge Responses ↔ Chat", () => {
    it("openai-responses → openai: converts response", () => {
      const respBody = JSON.stringify({
        id: "resp-1",
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: "Hi" }] }],
        model: "gpt-4o",
      });
      const result = JSON.parse(coord.transformResponse(respBody, "openai-responses", "openai"));
      expect(result.choices).toBeDefined();
    });

    it("openai → openai-responses: converts response", () => {
      const oaiBody = JSON.stringify({
        id: "chatcmpl-1",
        model: "gpt-4o",
        choices: [{ message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
      const result = JSON.parse(coord.transformResponse(oaiBody, "openai", "openai-responses"));
      expect(result.output).toBeDefined();
    });
  });

  // ----------------------------------------------------------------
  // transformErrorResponse
  // ----------------------------------------------------------------
  describe("transformErrorResponse", () => {
    it("returns body unchanged when same apiType", () => {
      const err = '{"error":{"message":"fail"}}';
      expect(coord.transformErrorResponse(err, "openai", "openai")).toBe(err);
      expect(coord.transformErrorResponse(err, "openai-responses", "openai-responses")).toBe(err);
      expect(coord.transformErrorResponse(err, "anthropic", "anthropic")).toBe(err);
    });

    it("openai-responses → anthropic: converts error", () => {
      const err = JSON.stringify({ error: { message: "rate limited" } });
      const result = JSON.parse(coord.transformErrorResponse(err, "openai-responses", "anthropic"));
      expect(result.type).toBe("error");
      expect(result.error.message).toBe("rate limited");
    });

    it("anthropic → openai-responses: converts error", () => {
      const err = JSON.stringify({ type: "error", error: { type: "api_error", message: "overloaded" } });
      const result = JSON.parse(coord.transformErrorResponse(err, "anthropic", "openai-responses"));
      expect(result.error.message).toBe("overloaded");
      expect(result.error.code).toBe("upstream_error");
    });

    it("openai-responses → openai: converts error", () => {
      const err = JSON.stringify({ error: { message: "bad request" } });
      const result = JSON.parse(coord.transformErrorResponse(err, "openai-responses", "openai"));
      expect(result.error.message).toBe("bad request");
      expect(result.error.type).toBe("api_error");
    });

    it("openai → openai-responses: converts error", () => {
      const err = JSON.stringify({ error: { message: "timeout", type: "timeout" } });
      const result = JSON.parse(coord.transformErrorResponse(err, "openai", "openai-responses"));
      expect(result.error.message).toBe("timeout");
      expect(result.error.type).toBe("invalid_request_error");
    });

    it("falls through to existing Chat ↔ Anthropic error conversion", () => {
      const antError = JSON.stringify({ type: "error", error: { type: "err", message: "fail" } });
      const result = JSON.parse(coord.transformErrorResponse(antError, "anthropic", "openai"));
      expect(result.error.message).toBe("fail");
    });

    it("returns raw body on parse failure", () => {
      const invalid = "not json at all";
      expect(coord.transformErrorResponse(invalid, "openai", "anthropic")).toBe(invalid);
    });
  });

  // ----------------------------------------------------------------
  // createFormatTransform
  // ----------------------------------------------------------------
  describe("createFormatTransform", () => {
    it("returns undefined for same apiType", () => {
      expect(coord.createFormatTransform("openai", "openai", "gpt-4")).toBeUndefined();
      expect(coord.createFormatTransform("anthropic", "anthropic", "claude-3")).toBeUndefined();
      expect(coord.createFormatTransform("openai-responses", "openai-responses", "gpt-4o")).toBeUndefined();
    });

    it("returns ResponsesToAnthropicTransform for openai-responses client → anthropic provider", () => {
      const t = coord.createFormatTransform("openai-responses", "anthropic", "gpt-4o");
      expect(t).toBeInstanceOf(ResponsesToAnthropicTransform);
    });

    it("returns AnthropicToResponsesTransform for anthropic client → openai-responses provider", () => {
      const t = coord.createFormatTransform("anthropic", "openai-responses", "claude-3");
      expect(t).toBeInstanceOf(AnthropicToResponsesTransform);
    });

    it("returns OpenAIToAnthropicTransform for anthropic client → openai provider", () => {
      const t = coord.createFormatTransform("anthropic", "openai", "claude-3");
      expect(t).toBeInstanceOf(OpenAIToAnthropicTransform);
    });

    it("returns AnthropicToOpenAITransform for openai client → anthropic provider", () => {
      const t = coord.createFormatTransform("openai", "anthropic", "gpt-4");
      expect(t).toBeInstanceOf(AnthropicToOpenAITransform);
    });

    it("returns ResponsesToChatBridgeTransform for openai-responses client → openai provider", () => {
      const t = coord.createFormatTransform("openai-responses", "openai", "gpt-4o");
      expect(t).toBeInstanceOf(ResponsesToChatBridgeTransform);
    });

    it("returns ChatToResponsesBridgeTransform for openai client → openai-responses provider", () => {
      const t = coord.createFormatTransform("openai", "openai-responses", "gpt-4o");
      expect(t).toBeInstanceOf(ChatToResponsesBridgeTransform);
    });
  });

  // ----------------------------------------------------------------
  // getUpstreamPath (tested via transformRequest identity paths)
  // ----------------------------------------------------------------
  describe("getUpstreamPath", () => {
    it("returns /v1/chat/completions for openai", () => {
      const result = coord.transformRequest({ model: "gpt-4" }, "openai", "openai", "gpt-4");
      expect(result.upstreamPath).toBe("/v1/chat/completions");
    });

    it("returns /v1/messages for anthropic", () => {
      const result = coord.transformRequest({ model: "claude-3" }, "anthropic", "anthropic", "claude-3");
      expect(result.upstreamPath).toBe("/v1/messages");
    });

    it("returns /v1/responses for openai-responses", () => {
      const result = coord.transformRequest({ model: "gpt-4o" }, "openai-responses", "openai-responses", "gpt-4o");
      expect(result.upstreamPath).toBe("/v1/responses");
    });

    it("returns /v1/chat/completions for unknown apiType", () => {
      const result = coord.transformRequest({ model: "x" }, "unknown" as string, "unknown" as string, "x");
      expect(result.upstreamPath).toBe("/v1/chat/completions");
    });
  });
});

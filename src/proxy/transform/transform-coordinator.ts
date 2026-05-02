import type { Transform } from "stream";
import { transformRequestBody } from "./request-transform.js";
import {
  transformResponseBody,
  transformErrorResponse as transformErrorBody,
} from "./response-transform.js";
import { OpenAIToAnthropicTransform } from "./stream-oa2ant.js";
import { AnthropicToOpenAITransform } from "./stream-ant2oa.js";
import {
  responsesToAnthropicRequest,
  anthropicToResponsesRequest,
} from "./request-transform-responses.js";
import {
  responsesToAnthropicResponse,
  anthropicToResponsesResponse,
} from "./response-transform-responses.js";
import {
  responsesToChatRequest,
  chatToResponsesRequest,
} from "./request-bridge-responses.js";
import {
  responsesToChatResponse,
  chatToResponsesResponse,
} from "./response-bridge-responses.js";
import { AnthropicToResponsesTransform } from "./stream-ant2resp.js";
import { ResponsesToAnthropicTransform } from "./stream-resp2ant.js";
import { ChatToResponsesBridgeTransform } from "./stream-bridge-chat2resp.js";
import { ResponsesToChatBridgeTransform } from "./stream-bridge-resp2chat.js";

export class TransformCoordinator {
  needsTransform(entryApiType: string, providerApiType: string): boolean {
    return entryApiType !== providerApiType;
  }

  transformRequest(
    body: Record<string, unknown>,
    entryApiType: string,
    providerApiType: string,
    model: string,
  ): { body: Record<string, unknown>; upstreamPath: string } {
    if (entryApiType === providerApiType) {
      return { body, upstreamPath: this.getUpstreamPath(providerApiType) };
    }

    // Tier-1: Responses ↔ Anthropic
    if (entryApiType === "openai-responses" && providerApiType === "anthropic") {
      return { body: responsesToAnthropicRequest(body), upstreamPath: "/v1/messages" };
    }
    if (entryApiType === "anthropic" && providerApiType === "openai-responses") {
      return { body: anthropicToResponsesRequest(body), upstreamPath: "/v1/responses" };
    }

    // Existing: OpenAI Chat ↔ Anthropic
    if (entryApiType === "openai" && providerApiType === "anthropic") {
      return { body: transformRequestBody(body, "openai", "anthropic", model), upstreamPath: "/v1/messages" };
    }
    if (entryApiType === "anthropic" && providerApiType === "openai") {
      return { body: transformRequestBody(body, "anthropic", "openai", model), upstreamPath: "/v1/chat/completions" };
    }

    // Bridge: Responses ↔ Chat
    if (entryApiType === "openai-responses" && providerApiType === "openai") {
      return { body: responsesToChatRequest(body), upstreamPath: "/v1/chat/completions" };
    }
    if (entryApiType === "openai" && providerApiType === "openai-responses") {
      return { body: chatToResponsesRequest(body), upstreamPath: "/v1/responses" };
    }

    return { body, upstreamPath: this.getUpstreamPath(providerApiType) };
  }

  transformResponse(bodyStr: string, sourceApiType: string, targetApiType: string): string {
    if (sourceApiType === targetApiType) return bodyStr;

    // Tier-1
    if (sourceApiType === "openai-responses" && targetApiType === "anthropic") {
      return responsesToAnthropicResponse(bodyStr);
    }
    if (sourceApiType === "anthropic" && targetApiType === "openai-responses") {
      return anthropicToResponsesResponse(bodyStr);
    }

    // Existing
    if (sourceApiType === "openai" && targetApiType === "anthropic") {
      return transformResponseBody(bodyStr, "openai", "anthropic");
    }
    if (sourceApiType === "anthropic" && targetApiType === "openai") {
      return transformResponseBody(bodyStr, "anthropic", "openai");
    }

    // Bridge
    if (sourceApiType === "openai-responses" && targetApiType === "openai") {
      return responsesToChatResponse(bodyStr);
    }
    if (sourceApiType === "openai" && targetApiType === "openai-responses") {
      return chatToResponsesResponse(bodyStr);
    }

    return bodyStr;
  }

  transformErrorResponse(bodyStr: string, sourceApiType: string, targetApiType: string): string {
    if (sourceApiType === targetApiType) return bodyStr;
    try {
      const parsed = JSON.parse(bodyStr);

      // Responses ↔ Anthropic error conversion
      if (sourceApiType === "openai-responses" && targetApiType === "anthropic") {
        const err = parsed.error ?? parsed;
        return JSON.stringify({
          type: "error",
          error: { type: "api_error", message: err.message ?? String(err) },
        });
      }
      if (sourceApiType === "anthropic" && targetApiType === "openai-responses") {
        const err = parsed.error ?? parsed;
        return JSON.stringify({
          error: {
            message: err.message ?? String(err),
            type: "invalid_request_error",
            code: "upstream_error",
          },
        });
      }

      // Responses ↔ Chat error conversion
      if (sourceApiType === "openai-responses" && targetApiType === "openai") {
        const err = parsed.error ?? parsed;
        return JSON.stringify({
          error: { message: err.message ?? String(err), type: "api_error", code: "upstream_error" },
        });
      }
      if (sourceApiType === "openai" && targetApiType === "openai-responses") {
        const err = parsed.error ?? parsed;
        return JSON.stringify({
          error: {
            message: err.message ?? String(err),
            type: "invalid_request_error",
            code: "upstream_error",
          },
        });
      }

      // Fall through to existing Chat ↔ Anthropic error conversion
      return transformErrorBody(bodyStr, sourceApiType, targetApiType);
    } catch {
      return bodyStr;
    }
  }

  createFormatTransform(
    entryApiType: string,
    providerApiType: string,
    model: string,
  ): Transform | undefined {
    if (entryApiType === providerApiType) return undefined;

    // Tier-1 streaming
    if (providerApiType === "anthropic" && entryApiType === "openai-responses") {
      return new ResponsesToAnthropicTransform(model);
    }
    if (providerApiType === "openai-responses" && entryApiType === "anthropic") {
      return new AnthropicToResponsesTransform(model);
    }

    // Existing streaming
    if (providerApiType === "openai" && entryApiType === "anthropic") {
      return new OpenAIToAnthropicTransform(model);
    }
    if (providerApiType === "anthropic" && entryApiType === "openai") {
      return new AnthropicToOpenAITransform(model);
    }

    // Bridge streaming
    if (providerApiType === "openai" && entryApiType === "openai-responses") {
      return new ResponsesToChatBridgeTransform(model);
    }
    if (providerApiType === "openai-responses" && entryApiType === "openai") {
      return new ChatToResponsesBridgeTransform(model);
    }

    return undefined;
  }

  private getUpstreamPath(apiType: string): string {
    switch (apiType) {
      case "openai": return "/v1/chat/completions";
      case "openai-responses": return "/v1/responses";
      case "anthropic": return "/v1/messages";
      default: return "/v1/chat/completions";
    }
  }
}

import type { Transform } from "stream";
import { transformRequestBody, openaiToAnthropicRequest, anthropicToOpenAIRequest } from "./request-transform.js";
import { transformResponseBody, openaiResponseToAnthropic, anthropicResponseToOpenAI, transformErrorResponse } from "./response-transform.js";
import { OpenAIToAnthropicTransform, AnthropicToOpenAITransform } from "./stream-transform.js";

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
    const upstreamPath = providerApiType === "openai" ? "/v1/chat/completions" : "/v1/messages";
    if (!this.needsTransform(entryApiType, providerApiType)) {
      return { body, upstreamPath };
    }
    const transformed = entryApiType === "openai"
      ? openaiToAnthropicRequest(body, model)
      : anthropicToOpenAIRequest(body, model);
    return { body: transformed, upstreamPath };
  }

  transformResponse(bodyStr: string, sourceApiType: string, targetApiType: string): string {
    return transformResponseBody(bodyStr, sourceApiType, targetApiType);
  }

  transformErrorResponse(bodyStr: string, sourceApiType: string, targetApiType: string): string {
    return transformErrorResponse(bodyStr, sourceApiType, targetApiType);
  }

  createFormatTransform(
    entryApiType: string,
    providerApiType: string,
    model: string,
  ): Transform | undefined {
    if (!this.needsTransform(entryApiType, providerApiType)) return undefined;
    // source=provider格式, target=客户端格式
    if (providerApiType === "openai" && entryApiType === "anthropic") {
      return new OpenAIToAnthropicTransform(model);
    }
    if (providerApiType === "anthropic" && entryApiType === "openai") {
      return new AnthropicToOpenAITransform(model);
    }
    return undefined;
  }
}

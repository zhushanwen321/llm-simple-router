import type { Transform } from "stream";
import { transformRequestBody } from "./request-transform.js";
import { transformResponseBody, transformErrorResponse } from "./response-transform.js";
import { OpenAIToAnthropicTransform } from "./stream-oa2ant.js";
import { AnthropicToOpenAITransform } from "./stream-ant2oa.js";

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
    return { body: transformRequestBody(body, entryApiType, providerApiType, model), upstreamPath };
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
    // 上游=provider格式, 客户端=entry格式
    // OA provider + Ant client → OpenAIToAnthropicTransform
    if (providerApiType === "openai" && entryApiType === "anthropic") {
      return new OpenAIToAnthropicTransform(model);
    }
    if (providerApiType === "anthropic" && entryApiType === "openai") {
      return new AnthropicToOpenAITransform(model);
    }
    return undefined;
  }
}

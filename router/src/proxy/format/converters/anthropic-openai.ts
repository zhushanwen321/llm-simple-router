import type { FormatConverter } from "../types.js";
import { anthropicToOpenAIRequest } from "../../transform/request-transform.js";
import { anthropicResponseToOpenAI } from "../../transform/response-transform.js";
import { AnthropicToOpenAITransform } from "../../transform/stream-ant2oa.js";

export const anthropicToOpenAIConverter: FormatConverter = {
  sourceType: "anthropic",
  targetType: "openai",

  transformRequest(body, _model) {
    return {
      body: anthropicToOpenAIRequest(body),
      upstreamPath: "/v1/chat/completions",
    };
  },

  transformResponse(bodyStr) {
    return anthropicResponseToOpenAI(bodyStr);
  },

  createStreamTransform(model) {
    return new AnthropicToOpenAITransform(model);
  },
};

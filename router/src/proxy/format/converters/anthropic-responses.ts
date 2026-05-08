import type { FormatConverter } from "../types.js";
import { anthropicToResponsesRequest } from "../../transform/request-transform-responses.js";
import { anthropicToResponsesResponse } from "../../transform/response-transform-responses.js";
import { AnthropicToResponsesTransform } from "../../transform/stream-ant2resp.js";

export const anthropicToResponsesConverter: FormatConverter = {
  sourceType: "anthropic",
  targetType: "openai-responses",

  transformRequest(body, _model) {
    return {
      body: anthropicToResponsesRequest(body),
      upstreamPath: "/v1/responses",
    };
  },

  transformResponse(bodyStr) {
    return anthropicToResponsesResponse(bodyStr);
  },

  createStreamTransform(model) {
    return new AnthropicToResponsesTransform(model);
  },
};

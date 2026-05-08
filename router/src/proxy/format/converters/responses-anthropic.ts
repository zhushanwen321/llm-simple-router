import type { FormatConverter } from "../types.js";
import { responsesToAnthropicRequest } from "../../transform/request-transform-responses.js";
import { responsesToAnthropicResponse } from "../../transform/response-transform-responses.js";
import { ResponsesToAnthropicTransform } from "../../transform/stream-resp2ant.js";

export const responsesToAnthropicConverter: FormatConverter = {
  sourceType: "openai-responses",
  targetType: "anthropic",

  transformRequest(body, _model) {
    return {
      body: responsesToAnthropicRequest(body),
      upstreamPath: "/v1/messages",
    };
  },

  transformResponse(bodyStr) {
    return responsesToAnthropicResponse(bodyStr);
  },

  createStreamTransform(model) {
    return new ResponsesToAnthropicTransform(model);
  },
};

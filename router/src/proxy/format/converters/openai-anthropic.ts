import type { FormatConverter } from "../types.js";
import { openaiToAnthropicRequest } from "../../transform/request-transform.js";
import { openaiResponseToAnthropic } from "../../transform/response-transform.js";
import { OpenAIToAnthropicTransform } from "../../transform/stream-oa2ant.js";

export const openaiToAnthropicConverter: FormatConverter = {
  sourceType: "openai",
  targetType: "anthropic",

  transformRequest(body, _model) {
    return {
      body: openaiToAnthropicRequest(body),
      upstreamPath: "/v1/messages",
    };
  },

  transformResponse(bodyStr) {
    return openaiResponseToAnthropic(bodyStr);
  },

  createStreamTransform(model) {
    return new OpenAIToAnthropicTransform(model);
  },
};

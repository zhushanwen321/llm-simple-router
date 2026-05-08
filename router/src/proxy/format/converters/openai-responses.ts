import type { FormatConverter } from "../types.js";
import { chatToResponsesRequest } from "../../transform/request-bridge-responses.js";
import { chatToResponsesResponse } from "../../transform/response-bridge-responses.js";
import { ChatToResponsesBridgeTransform } from "../../transform/stream-bridge-chat2resp.js";

export const openaiToResponsesConverter: FormatConverter = {
  sourceType: "openai",
  targetType: "openai-responses",

  transformRequest(body, _model) {
    return {
      body: chatToResponsesRequest(body),
      upstreamPath: "/v1/responses",
    };
  },

  transformResponse(bodyStr) {
    return chatToResponsesResponse(bodyStr);
  },

  createStreamTransform(model) {
    return new ChatToResponsesBridgeTransform(model);
  },
};

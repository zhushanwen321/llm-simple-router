import type { FormatConverter } from "../types.js";
import { responsesToChatRequest } from "../../transform/request-bridge-responses.js";
import { responsesToChatResponse } from "../../transform/response-bridge-responses.js";
import { ResponsesToChatBridgeTransform } from "../../transform/stream-bridge-resp2chat.js";

export const responsesToOpenAIConverter: FormatConverter = {
  sourceType: "openai-responses",
  targetType: "openai",

  transformRequest(body, _model) {
    return {
      body: responsesToChatRequest(body),
      upstreamPath: "/v1/chat/completions",
    };
  },

  transformResponse(bodyStr) {
    return responsesToChatResponse(bodyStr);
  },

  createStreamTransform(model) {
    return new ResponsesToChatBridgeTransform(model);
  },
};

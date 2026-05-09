import { createConverter } from "../types.js";
import { responsesToChatRequest } from "../../transform/request-bridge-responses.js";
import { responsesToChatResponse } from "../../transform/response-bridge-responses.js";
import { ResponsesToChatBridgeTransform } from "../../transform/stream-bridge-resp2chat.js";

export const responsesToOpenAIConverter = createConverter({
  sourceType: "openai-responses",
  targetType: "openai",
  requestTransform: responsesToChatRequest,
  responseTransform: responsesToChatResponse,
  streamTransformClass: ResponsesToChatBridgeTransform,
});

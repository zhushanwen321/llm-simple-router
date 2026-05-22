import { createConverter } from "../types.js";
import {
  chatToResponsesRequest,
  responsesToChatRequest,
} from "../../transform/request-bridge-responses.js";
import {
  chatToResponsesResponse,
  responsesToChatResponse,
} from "../../transform/response-bridge-responses.js";
import { ChatToResponsesBridgeTransform } from "../../transform/stream-bridge-chat2resp.js";
import { ResponsesToChatBridgeTransform } from "../../transform/stream-bridge-resp2chat.js";
import { responsesToAnthropicRequest } from "../../transform/request-transform-responses.js";
import { responsesToAnthropicResponse } from "../../transform/response-transform-responses.js";
import { ResponsesToAnthropicTransform } from "../../transform/stream-resp2ant.js";

export const openaiToResponsesConverter = createConverter({
  sourceType: "openai",
  targetType: "openai-responses",
  requestTransform: chatToResponsesRequest,
  responseTransform: chatToResponsesResponse,
  streamTransformClass: ChatToResponsesBridgeTransform,
});

export const responsesToOpenAIConverter = createConverter({
  sourceType: "openai-responses",
  targetType: "openai",
  requestTransform: responsesToChatRequest,
  responseTransform: responsesToChatResponse,
  streamTransformClass: ResponsesToChatBridgeTransform,
});

export const responsesToAnthropicConverter = createConverter({
  sourceType: "openai-responses",
  targetType: "anthropic",
  requestTransform: responsesToAnthropicRequest,
  responseTransform: responsesToAnthropicResponse,
  streamTransformClass: ResponsesToAnthropicTransform,
});

import { createConverter } from "../types.js";
import { chatToResponsesRequest } from "../../transform/request-bridge-responses.js";
import { chatToResponsesResponse } from "../../transform/response-bridge-responses.js";
import { ChatToResponsesBridgeTransform } from "../../transform/stream-bridge-chat2resp.js";

export const openaiToResponsesConverter = createConverter({
  sourceType: "openai",
  targetType: "openai-responses",
  requestTransform: chatToResponsesRequest,
  responseTransform: chatToResponsesResponse,
  streamTransformClass: ChatToResponsesBridgeTransform,
});

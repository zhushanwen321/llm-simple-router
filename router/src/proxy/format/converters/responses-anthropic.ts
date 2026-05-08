import { createConverter } from "../types.js";
import { responsesToAnthropicRequest } from "../../transform/request-transform-responses.js";
import { responsesToAnthropicResponse } from "../../transform/response-transform-responses.js";
import { ResponsesToAnthropicTransform } from "../../transform/stream-resp2ant.js";

export const responsesToAnthropicConverter = createConverter({
  sourceType: "openai-responses",
  targetType: "anthropic",
  requestTransform: responsesToAnthropicRequest,
  responseTransform: responsesToAnthropicResponse,
  streamTransformClass: ResponsesToAnthropicTransform,
});

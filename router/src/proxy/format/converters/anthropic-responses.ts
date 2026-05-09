import { createConverter } from "../types.js";
import { anthropicToResponsesRequest } from "../../transform/request-transform-responses.js";
import { anthropicToResponsesResponse } from "../../transform/response-transform-responses.js";
import { AnthropicToResponsesTransform } from "../../transform/stream-ant2resp.js";

export const anthropicToResponsesConverter = createConverter({
  sourceType: "anthropic",
  targetType: "openai-responses",
  requestTransform: anthropicToResponsesRequest,
  responseTransform: anthropicToResponsesResponse,
  streamTransformClass: AnthropicToResponsesTransform,
});

import { createConverter } from "../types.js";
import { anthropicToOpenAIRequest } from "../../transform/request-transform.js";
import { anthropicResponseToOpenAI } from "../../transform/response-transform.js";
import { AnthropicToOpenAITransform } from "../../transform/stream-ant2oa.js";

export const anthropicToOpenAIConverter = createConverter({
  sourceType: "anthropic",
  targetType: "openai",
  requestTransform: anthropicToOpenAIRequest,
  responseTransform: anthropicResponseToOpenAI,
  streamTransformClass: AnthropicToOpenAITransform,
});

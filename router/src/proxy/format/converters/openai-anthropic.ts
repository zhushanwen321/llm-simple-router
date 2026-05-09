import { createConverter } from "../types.js";
import { openaiToAnthropicRequest } from "../../transform/request-transform.js";
import { openaiResponseToAnthropic } from "../../transform/response-transform.js";
import { OpenAIToAnthropicTransform } from "../../transform/stream-oa2ant.js";

export const openaiToAnthropicConverter = createConverter({
  sourceType: "openai",
  targetType: "anthropic",
  requestTransform: openaiToAnthropicRequest,
  responseTransform: openaiResponseToAnthropic,
  streamTransformClass: OpenAIToAnthropicTransform,
});

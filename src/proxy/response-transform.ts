import { buildModelInfoTag } from "./enhancement/enhancement-handler.js";

export interface ResponseTransformMeta {
  model_info_tag_injected: boolean;
}

export function maybeInjectModelInfoTag(
  responseBody: string,
  originalModel: string | null,
  effectiveModel: string,
): { body: string; meta: ResponseTransformMeta } {
  if (!originalModel) {
    return { body: responseBody, meta: { model_info_tag_injected: false } };
  }
  try {
    const bodyObj = JSON.parse(responseBody);
    if (bodyObj.content?.[0]?.text) {
      bodyObj.content[0].text += `\n\n${buildModelInfoTag(effectiveModel)}`;
      return { body: JSON.stringify(bodyObj), meta: { model_info_tag_injected: true } };
    }
  } catch { /* non-JSON response, skip injection */ }
  return { body: responseBody, meta: { model_info_tag_injected: false } };
}

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
    // Responses format: output[type=message].content[type=output_text].text
    if (Array.isArray(bodyObj.output)) {
      for (const item of bodyObj.output as Array<Record<string, unknown>>) {
        if (item.type === "message" && Array.isArray(item.content)) {
          for (const part of item.content as Array<Record<string, unknown>>) {
            if (part.type === "output_text" && part.text) {
              (part as Record<string, unknown>).text = (part.text as string) + `\n\n${buildModelInfoTag(effectiveModel)}`;
              return { body: JSON.stringify(bodyObj), meta: { model_info_tag_injected: true } };
            }
          }
        }
      }
    }
  } catch { /* non-JSON response, skip injection */ }
  return { body: responseBody, meta: { model_info_tag_injected: false } };
}

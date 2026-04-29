import { describe, it, expect } from "vitest";
import { maybeInjectModelInfoTag } from "../src/proxy/response-transform.js";

describe("maybeInjectModelInfoTag", () => {
  const anthropicSuccessBody = JSON.stringify({
    content: [{ type: "text", text: "Hello" }],
  });

  it("originalModel 存在时注入 model-info 标签", () => {
    const result = maybeInjectModelInfoTag(anthropicSuccessBody, "original-model", "effective-model");
    expect(result.body).not.toBe(anthropicSuccessBody);
    const parsed = JSON.parse(result.body);
    expect(parsed.content[0].text).toContain("effective-model");
    expect(result.meta.model_info_tag_injected).toBe(true);
  });

  it("originalModel 为 null 时不注入", () => {
    const result = maybeInjectModelInfoTag(anthropicSuccessBody, null, "effective-model");
    expect(result.body).toBe(anthropicSuccessBody);
    expect(result.meta.model_info_tag_injected).toBe(false);
  });

  it("非 JSON body 不崩溃，返回原 body", () => {
    const result = maybeInjectModelInfoTag("not json", "orig", "eff");
    expect(result.body).toBe("not json");
    expect(result.meta.model_info_tag_injected).toBe(false);
  });
});

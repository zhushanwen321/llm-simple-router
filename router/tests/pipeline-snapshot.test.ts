import { describe, it, expect } from "vitest";
import { PipelineSnapshot, type StageRecord } from "../src/proxy/pipeline-snapshot.js";

describe("PipelineSnapshot", () => {
  it("add + toJSON 生成有序 JSON 数组", () => {
    const snap = new PipelineSnapshot();
    snap.add({ stage: "enhancement", router_tags_stripped: 1, directive: null });
    snap.add({ stage: "routing", client_model: "a", backend_model: "b", provider_id: "p1", strategy: "failover" });
    const parsed = JSON.parse(snap.toJSON());
    expect(parsed).toHaveLength(2);
    expect(parsed[0].stage).toBe("enhancement");
    expect(parsed[1].stage).toBe("routing");
  });

  it("空 snapshot 返回空数组", () => {
    const snap = new PipelineSnapshot();
    expect(JSON.parse(snap.toJSON())).toEqual([]);
  });

  it("构造函数接受初始 stages 并深拷贝", () => {
    const initial: StageRecord[] = [{ stage: "enhancement", router_tags_stripped: 1, directive: null }];
    const snap = new PipelineSnapshot(initial);
    snap.add({ stage: "routing", client_model: "a", backend_model: "b", provider_id: "p1", strategy: "failover" });
    expect(initial).toHaveLength(1);
    const parsed = JSON.parse(snap.toJSON());
    expect(parsed).toHaveLength(2);
  });

  it("StageRecord 各变体类型正确", () => {
  const records: StageRecord[] = [
    { stage: "enhancement", router_tags_stripped: 0, directive: { type: "select_model", value: "x" } },
    { stage: "tool_guard", action: "inject_break_prompt", tool: "read_file" },
    { stage: "routing", client_model: "a", backend_model: "b", provider_id: "p1", strategy: "round_robin" },
    { stage: "overflow", triggered: false },
    { stage: "provider_patch", types: ["deepseek_tool_use_to_text"] },
    { stage: "response_transform", model_info_tag_injected: true },
  ];
  expect(records).toHaveLength(6);
  });
});

// ============================================================
// T5: StageRecord "image-redirect" 变体测试
// 实现尚未存在，以下测试必须 FAIL
// ============================================================
describe("StageRecord image-redirect variant", () => {
  it("StageRecord accepts image-redirect variant with required fields", () => {
  // 构造 image-redirect StageRecord，验证类型系统接受它
  const record: StageRecord = {
    stage: "image-redirect",
    triggered: true,
    original_model: "gpt-5.1",
    redirect_to: "gpt-4o",
    redirect_provider: "openai",
    reason: "image_detected_model_not_capable",
  };

  expect(record.stage).toBe("image-redirect");
  expect(record.triggered).toBe(true);
  expect(record.original_model).toBe("gpt-5.1");
  expect(record.redirect_to).toBe("gpt-4o");
  expect(record.redirect_provider).toBe("openai");
  expect(record.reason).toBe("image_detected_model_not_capable");
  });

  it("PipelineSnapshot.add accepts image-redirect record", () => {
  const snap = new PipelineSnapshot();
  snap.add({
    stage: "image-redirect",
    triggered: true,
    original_model: "glm-5",
    redirect_to: "gpt-4o",
    redirect_provider: "openai",
    reason: "image_detected_model_not_capable",
  });

  const parsed = JSON.parse(snap.toJSON());
  expect(parsed).toHaveLength(1);
  expect(parsed[0].stage).toBe("image-redirect");
  expect(parsed[0].triggered).toBe(true);
  expect(parsed[0].original_model).toBe("glm-5");
  expect(parsed[0].redirect_to).toBe("gpt-4o");
  expect(parsed[0].redirect_provider).toBe("openai");
  expect(parsed[0].reason).toBe("image_detected_model_not_capable");
  });

  it("StageRecord image-redirect with triggered=false", () => {
  const record: StageRecord = {
    stage: "image-redirect",
    triggered: false,
    original_model: "gpt-4o",
    redirect_to: "",
    redirect_provider: "",
    reason: "no_image_detected",
  };

  expect(record.triggered).toBe(false);
  });
});

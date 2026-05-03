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

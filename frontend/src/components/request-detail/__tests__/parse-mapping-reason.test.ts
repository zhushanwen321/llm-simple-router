/**
 * parseMappingReason 白名单透传测试（T7b，设计文档 §10 详情场景）。
 *
 * 应用 test-quality skill 降级原则：原设计要求端到端测「详情 API + 前端白名单」，
 * 但拆分为后端 log 字段（已被 failover-circuit-breaker.test.ts TC1/TC2 覆盖）
 * + 本测试（前端纯函数白名单）。避免高成本 E2E，保留同等回归保护。
 *
 * mutation 自检：从 KNOWN_MAPPING_REASONS 删除 circuit_breaker_skip →
 *   parseMappingReason 返回 undefined → toBe("circuit_breaker_skip") 红。
 */
import { describe, it, expect } from "vitest";
import { parseMappingReason } from "../types";

// 构造 pipeline_snapshot JSON：routing stage 含指定 mapping_reason
const snapshotWith = (reason: string): string =>
  JSON.stringify([{ stage: "routing", mapping_reason: reason }]);

describe("parseMappingReason: §10 熔断新值白名单透传", () => {
  it("circuit_breaker_skip 不被过滤（返回原值）", () => {
    expect(parseMappingReason(snapshotWith("circuit_breaker_skip"))).toBe(
      "circuit_breaker_skip",
    );
  });

  it("session_affinity 不被过滤（返回原值）", () => {
    expect(parseMappingReason(snapshotWith("session_affinity"))).toBe(
      "session_affinity",
    );
  });

  it("未知 mapping_reason 被过滤为 undefined（白名单机制有效）", () => {
    expect(
      parseMappingReason(snapshotWith("unknown_future_value")),
    ).toBeUndefined();
  });

  it("历史已知值仍正常透传（回归保护）", () => {
    expect(parseMappingReason(snapshotWith("overflow_redirect"))).toBe(
      "overflow_redirect",
    );
    expect(parseMappingReason(snapshotWith("group_base_rule"))).toBe(
      "group_base_rule",
    );
    expect(parseMappingReason(snapshotWith("failover_retry"))).toBe(
      "failover_retry",
    );
  });

  it("overflow 触发优先于 routing stage（§10 overflow 留痕）", () => {
    const snap = JSON.stringify([
      { stage: "overflow", triggered: true },
      { stage: "routing", mapping_reason: "circuit_breaker_skip" },
    ]);
    expect(parseMappingReason(snap)).toBe("overflow_redirect");
  });

  it("空/非法输入返回 undefined", () => {
    expect(parseMappingReason(null)).toBeUndefined();
    expect(parseMappingReason("")).toBeUndefined();
    expect(parseMappingReason("not-json")).toBeUndefined();
    expect(parseMappingReason("[]")).toBeUndefined();
  });
});

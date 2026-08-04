import { describe, it, expect } from "vitest";
import type {
  Target,
  CircuitBreakerConfig,
  MappingReason,
  ResolveResult,
} from "../src/core/types";

/**
 * W1 cb-types-contract：核心类型契约基础层测试。
 * 验证 CircuitBreakerConfig / Target.circuit_breaker / MappingReason 新取值 / ResolveResult 扩展字段。
 */
describe("W1 类型契约: CircuitBreakerConfig / Target / MappingReason / ResolveResult", () => {
  it("Target 不带 circuit_breaker 时默认 undefined（向后兼容历史 group rule）", () => {
    const t: Target = { backend_model: "gpt-4o", provider_id: "p1" };
    expect(t.circuit_breaker).toBeUndefined();
  });

  it("Target 可携带完整 circuit_breaker 配置", () => {
    const cb: CircuitBreakerConfig = {
      enabled: true,
      window_sec: 60,
      failure_rate: 0.9,
      min_samples: 10,
      cooldown_sec: 300,
    };
    const t: Target = {
      backend_model: "gpt-4o",
      provider_id: "p1",
      circuit_breaker: cb,
    };
    expect(t.circuit_breaker?.enabled).toBe(true);
    expect(t.circuit_breaker?.status_codes).toBeUndefined();
  });

  it("MappingReason 接受 circuit_breaker_skip / session_affinity 新取值", () => {
    const reasons: MappingReason[] = [
      "circuit_breaker_skip",
      "session_affinity",
      // 历史取值仍兼容
      "group_base_rule",
      "overflow_redirect",
    ];
    expect(reasons).toContain("circuit_breaker_skip");
    expect(reasons).toContain("session_affinity");
  });

  it("ResolveResult 扩展字段为可选，未填充时 undefined（允许 W1 独立编译，W4 填充）", () => {
    const r: ResolveResult = {
      target: { backend_model: "m", provider_id: "p" },
      targetCount: 1,
      mappingReason: "group_base_rule",
    };
    expect(r.group_id).toBeUndefined();
    expect(r.schedule_id).toBeUndefined();
    expect(r.configLevelTargetKeys).toBeUndefined();
  });

  it("ResolveResult 可携带熔断/亲和透传字段", () => {
    const r: ResolveResult = {
      target: { backend_model: "m", provider_id: "p" },
      targetCount: 2,
      mappingReason: "group_schedule",
      group_id: "grp-1",
      schedule_id: "sch-1",
      configLevelTargetKeys: new Set(["p1:m1", "p2:m2"]),
    };
    expect(r.group_id).toBe("grp-1");
    expect(r.schedule_id).toBe("sch-1");
    expect(r.configLevelTargetKeys?.has("p1:m1")).toBe(true);
    expect(r.configLevelTargetKeys?.size).toBe(2);
  });
});

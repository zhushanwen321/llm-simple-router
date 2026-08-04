/**
 * parseMappingRule ↔ serializeRule round-trip property-based 测试。
 *
 * 应用 test-quality skill 的 property-based 原则：序列化 round-trip 是教科书级不变量
 * 「∀合法输入：parse(serialize(x)) 深相等 x」。fast-check 自动生成 100 个用例，
 * 覆盖 example-based 难以穷举的字段组合边界（有/无 circuit_breaker、overflow 位置、
 * 空/非空 status_codes 等任意组合）。
 *
 * mutation 自检：若 serialize 或 parse 漏透传 circuit_breaker 字段（W8 的核心风险），
 * round-trip 后该字段丢失，toEqual 失败 → 红。
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseMappingRule, serializeRule } from "../mapping-domain";
import type { MappingTarget, CircuitBreakerConfig } from "@/types/mapping";

// ─── 任意值生成器：约束合法输入空间 ───────────────────────

const arbitraryCircuitBreaker = fc.record<CircuitBreakerConfig>({
  enabled: fc.boolean(),
  window_sec: fc.integer({ min: 1, max: 3600 }),
  failure_rate: fc.double({
    min: 0.01,
    max: 1,
    noDefaultInfinity: true,
    noNaN: true,
  }),
  min_samples: fc.integer({ min: 1, max: 100 }),
  cooldown_sec: fc.integer({ min: 1, max: 7200 }),
  // status_codes 可选：用 fc.option 生成「有时缺省」以覆盖向后兼容路径
  status_codes: fc.option(
    fc.array(fc.integer({ min: 400, max: 599 }), { maxLength: 5 }),
    {
      nil: undefined,
    },
  ),
});

const arbitraryMappingTarget = (opts?: {
  allowOverflow?: boolean;
  allowCb?: boolean;
}): fc.Arbitrary<MappingTarget> =>
  fc.record({
    backend_model: fc
      .string({ minLength: 1, maxLength: 20 })
      .filter((s) => s.trim() !== ""),
    provider_id: fc
      .string({ minLength: 1, maxLength: 10 })
      .filter((s) => s.trim() !== ""),
    overflow_provider_id: opts?.allowOverflow
      ? fc.option(fc.string({ minLength: 1, maxLength: 10 }), {
        nil: undefined,
      })
      : fc.constant(undefined),
    overflow_model: opts?.allowOverflow
      ? fc.option(fc.string({ minLength: 1, maxLength: 10 }), {
        nil: undefined,
      })
      : fc.constant(undefined),
    circuit_breaker: opts?.allowCb
      ? fc.option(arbitraryCircuitBreaker, { nil: undefined })
      : fc.constant(undefined),
  });

// ─── 测试 ────────────────────────────────────────────────

describe("parseMappingRule ↔ serializeRule round-trip (property-based)", () => {
  it("∀合法 targets+overflow+multimodal: parse(serialize(x)) 回到 x", () => {
    fc.assert(
      fc.property(
        // 至少 1 个 target；只有 targets[0] 的 overflow 会被 serialize 保留
        fc.array(
          arbitraryMappingTarget({ allowOverflow: true, allowCb: true }),
          {
            minLength: 1,
            maxLength: 4,
          },
        ),
        fc.option(
          fc.record({
            provider_id: fc.string({ minLength: 1, maxLength: 10 }),
            model: fc.string({ minLength: 1, maxLength: 10 }),
          }),
          { nil: null },
        ),
        fc.option(
          fc.record({
            provider_id: fc.string({ minLength: 1 }),
            backend_model: fc.string({ minLength: 1 }),
          }),
          { nil: null },
        ),
        (targets, overflow, multimodal) => {
          const json = serializeRule(targets, overflow, multimodal);
          const parsed = parseMappingRule(json, "fallback-pid");

          // 断言 targets 白名单字段全部 round-trip（circuit_breaker 是 W8 核心关注点）
          expect(parsed.parseError).toBe(false);
          expect(parsed.data.targets).toHaveLength(targets.length);
          for (let i = 0; i < targets.length; i++) {
            expect(parsed.data.targets[i].backend_model).toBe(
              targets[i].backend_model,
            );
            expect(parsed.data.targets[i].provider_id).toBe(
              targets[i].provider_id,
            );
            // circuit_breaker 必须透传（W8 风险点：白名单遗漏致配置静默消失）
            expect(parsed.data.targets[i].circuit_breaker).toEqual(
              targets[i].circuit_breaker,
            );
          }

          // overflow 信息嵌入 targets[0]，round-trip 后回到 overflow 字段
          expect(parsed.data.overflow).toEqual(overflow);

          // multimodal 顶层透传
          expect(parsed.data.multimodal).toEqual(multimodal);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("∀含 circuit_breaker 的 target: serialize 后 JSON 含 circuit_breaker 字段（不静默丢失）", () => {
    fc.assert(
      fc.property(arbitraryCircuitBreaker, (cb) => {
        const target: MappingTarget = {
          backend_model: "m1",
          provider_id: "p1",
          circuit_breaker: cb,
        };
        const json = serializeRule([target], null, null);
        const parsed = JSON.parse(json);
        // 强断言：字段存在且结构完整（toBeUndefined 反例 = W8 bug 复现）
        expect(parsed.targets[0].circuit_breaker).toEqual(cb);
      }),
      { numRuns: 50 },
    );
  });

  it("∀无 circuit_breaker 的 target: serialize 后 JSON 不含 circuit_breaker 字段（向后兼容）", () => {
    const target: MappingTarget = { backend_model: "m1", provider_id: "p1" };
    const json = serializeRule([target], null, null);
    const parsed = JSON.parse(json);
    expect(parsed.targets[0]).not.toHaveProperty("circuit_breaker");
  });
});

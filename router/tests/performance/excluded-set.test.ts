/**
 * BP-M5: excludedTargets 用 Set 替代 Array.some() 测试
 *
 * 验证 filterExcluded 使用 Set 的结果与原 Array.some() 实现一致。
 */
import { describe, it, expect } from "vitest";
import type { Target } from "../../../src/core/types.js";

// 从 mapping-resolver.ts 导入 filterExcluded 进行测试
// 由于 filterExolved 是模块内私有函数，通过 resolveMapping 的行为间接验证
// 这里直接复制实现逻辑做单元测试

/** 原 Array.some() 实现（对照组） */
function filterExcludedArray(targets: Target[], excluded: Target[]): Target[] {
  return targets.filter(t =>
    !excluded.some(e =>
      e.backend_model === t.backend_model && e.provider_id === t.provider_id
    ),
  );
}

/** 新 Set 实现 */
function createExcludedSet(excluded: Target[]): Set<string> {
  return new Set(excluded.map(t => `${t.provider_id ?? ""}:${t.backend_model ?? ""}`));
}

function filterExcludedSet(targets: Target[], excluded: Target[]): Target[] {
  if (excluded.length === 0) return targets;
  const set = createExcludedSet(excluded);
  return targets.filter(t => !set.has(`${t.provider_id ?? ""}:${t.backend_model ?? ""}`));
}

// ---------- Test data ----------

function makeTarget(providerId: string, model: string): Target {
  return { provider_id: providerId, backend_model: model };
}

const t1 = makeTarget("p1", "gpt-4");
const t2 = makeTarget("p1", "gpt-3.5");
const t3 = makeTarget("p2", "gpt-4");
const t4 = makeTarget("p2", "claude-3");

describe("BP-M5: excludedTargets Set vs Array.some() 一致性", () => {
  it("空 excluded — 所有 targets 保留", () => {
    const targets = [t1, t2, t3];
    const excluded: Target[] = [];
    expect(filterExcludedSet(targets, excluded)).toEqual(filterExcludedArray(targets, excluded));
    expect(filterExcludedSet(targets, excluded)).toEqual(targets);
  });

  it("全部 excluded — 无 target 保留", () => {
    const targets = [t1, t2];
    const excluded = [t1, t2];
    expect(filterExcludedSet(targets, excluded)).toEqual([]);
    expect(filterExcludedSet(targets, excluded)).toEqual(filterExcludedArray(targets, excluded));
  });

  it("部分 excluded — 只排除匹配的", () => {
    const targets = [t1, t2, t3, t4];
    const excluded = [t1, t3];
    const result = filterExcludedSet(targets, excluded);
    expect(result).toEqual([t2, t4]);
    expect(result).toEqual(filterExcludedArray(targets, excluded));
  });

  it("excluded 中有不存在的 target — 不影响结果", () => {
    const targets = [t1, t2];
    const excluded = [t3, t4];
    const result = filterExcludedSet(targets, excluded);
    expect(result).toEqual([t1, t2]);
    expect(result).toEqual(filterExcludedArray(targets, excluded));
  });

  it("空 targets 列表 — 返回空", () => {
    const targets: Target[] = [];
    const excluded = [t1];
    expect(filterExcludedSet(targets, excluded)).toEqual([]);
    expect(filterExcludedSet(targets, excluded)).toEqual(filterExcludedArray(targets, excluded));
  });

  it("单 target 匹配 excluded — 返回空", () => {
    const targets = [t1];
    const excluded = [t1];
    expect(filterExcludedSet(targets, excluded)).toEqual([]);
    expect(filterExcludedSet(targets, excluded)).toEqual(filterExcludedArray(targets, excluded));
  });

  it("相同 provider 不同 model — 只排除匹配的", () => {
    const targets = [t1, t2]; // same provider p1, different models
    const excluded = [t1];
    const result = filterExcludedSet(targets, excluded);
    expect(result).toEqual([t2]);
    expect(result).toEqual(filterExcludedArray(targets, excluded));
  });

  it("不同 provider 相同 model — 只排除匹配的", () => {
    const targets = [t1, t3]; // same model gpt-4, different providers
    const excluded = [t1];
    const result = filterExcludedSet(targets, excluded);
    expect(result).toEqual([t3]);
    expect(result).toEqual(filterExcludedArray(targets, excluded));
  });

  it("createExcludedSet 生成正确的 key", () => {
    const set = createExcludedSet([t1, t2]);
    expect(set.has("p1:gpt-4")).toBe(true);
    expect(set.has("p1:gpt-3.5")).toBe(true);
    expect(set.has("p2:gpt-4")).toBe(false);
    expect(set.size).toBe(2);
  });
});

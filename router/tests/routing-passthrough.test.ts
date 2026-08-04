/**
 * W4 路由解析透传层测试（circuit-breaker-affinity）
 *
 * 覆盖 resolveMapping 三条返回路径对 group_id / schedule_id / configLevelTargetKeys
 * 的填充，以及 expandOverflowTargets 派生 target 对 circuit_breaker 的继承。
 */
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { resolveMapping } from "../src/proxy/routing/mapping-resolver.js";
import { expandOverflowTargets } from "../src/proxy/routing/overflow.js";
import { initDatabase } from "../src/db/index.js";
import type { CircuitBreakerConfig, Target } from "../src/core/types.js";

describe("routing passthrough (circuit-breaker affinity W4)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  /** 插入 mapping group（rule 自动 stringify） */
  function insertGroup(id: string, clientModel: string, rule: unknown): void {
    db.prepare(
      "INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, clientModel, JSON.stringify(rule), 1, new Date().toISOString());
  }

  /** 插入一条 enabled schedule（mapping_rule 原样写入，调用方负责 stringify） */
  function insertSchedule(
    id: string,
    groupId: string,
    mappingRule: string,
    startHour: number,
    endHour: number,
  ): void {
    const nowIso = new Date().toISOString();
    db.prepare(
      `INSERT INTO schedules (id, mapping_group_id, name, enabled, week, start_hour, end_hour, mapping_rule, concurrency_rule, priority, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, groupId, id, 1, "[0,1,2,3,4,5,6]", startHour, endHour, mappingRule, null, 0, nowIso, nowIso);
  }

  // TC1: group 路径（无 schedule）填充 group_id + schedule_id(base) + configLevelTargetKeys
  it("TC1: group base rule 路径填充 group_id，schedule_id=undefined，configLevelTargetKeys 含 base targets", () => {
    insertGroup("g1", "m1", {
      targets: [
        { backend_model: "gpt-4o", provider_id: "p1" },
        { backend_model: "claude-3", provider_id: "p2" },
      ],
    });

    const result = resolveMapping(db, "m1", { now: new Date("2024-01-01T10:00:00") });
    expect(result).not.toBeNull();
    expect(result!.mappingReason).toBe("group_base_rule");
    expect(result!.group_id).toBe("g1");
    expect(result!.schedule_id).toBeUndefined();
    expect(result!.configLevelTargetKeys!.has("p1:gpt-4o")).toBe(true);
    expect(result!.configLevelTargetKeys!.has("p2:claude-3")).toBe(true);
  });

  // TC2: schedule 命中 → schedule_id 填充，configLevelTargetKeys 含 base + schedule targets
  it("TC2: schedule 命中时 schedule_id=schedule.id，configLevelTargetKeys 含 base 与 schedule 的 targets", () => {
    insertGroup("g1", "m1", {
      targets: [{ backend_model: "gpt-4o", provider_id: "p1" }],
    });
    insertSchedule(
      "s1",
      "g1",
      JSON.stringify({ targets: [{ backend_model: "sonnet", provider_id: "p3" }] }),
      9,
      18,
    );

    const result = resolveMapping(db, "m1", { now: new Date("2024-01-01T10:00:00") });
    expect(result!.mappingReason).toBe("group_schedule");
    expect(result!.group_id).toBe("g1");
    expect(result!.schedule_id).toBe("s1");
    expect(result!.configLevelTargetKeys!.has("p1:gpt-4o")).toBe(true);
    expect(result!.configLevelTargetKeys!.has("p3:sonnet")).toBe(true);
  });

  // TC3: schedule 命中但 mapping_rule 解析为空 → 回退 base，schedule_id 必须 undefined（门控语义）
  it("TC3: schedule 命中但 mapping_rule 为空回退 base → mappingReason=group_base_rule，schedule_id=undefined", () => {
    insertGroup("g1", "m1", {
      targets: [{ backend_model: "gpt-4o", provider_id: "p1" }],
    });
    // 时段命中（9~18），但 targets 为空数组 → parseScheduleTargets 返回 []
    insertSchedule("s1", "g1", JSON.stringify({ targets: [] }), 9, 18);

    const result = resolveMapping(db, "m1", { now: new Date("2024-01-01T10:00:00") });
    expect(result!.mappingReason).toBe("group_base_rule");
    expect(result!.schedule_id).toBeUndefined();
    expect(result!.target).toEqual({ backend_model: "gpt-4o", provider_id: "p1" });
  });

  // TC4: direct_format 路径 group_id=null、schedule_id=undefined
  it("TC4: direct_format 路径（provider_name/model）group_id=null、schedule_id=undefined", () => {
    db.prepare(
      "INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "p1",
      "openai-prov",
      "openai",
      "https://api.example.com",
      "sk-test",
      JSON.stringify(["gpt-4o"]),
      1,
      new Date().toISOString(),
      new Date().toISOString(),
    );

    const result = resolveMapping(db, "openai-prov/gpt-4o", { now: new Date() });
    expect(result!.mappingReason).toBe("direct_format");
    expect(result!.group_id).toBeNull();
    expect(result!.schedule_id).toBeUndefined();
  });

  // TC5: configLevelTargetKeys 含 overflow 扩展目标
  it("TC5: base target 配置 overflow_provider_id + overflow_model → configLevelTargetKeys 含溢出目标 key", () => {
    insertGroup("g1", "m1", {
      targets: [
        {
          backend_model: "gpt-4o",
          provider_id: "p1",
          overflow_provider_id: "ovp",
          overflow_model: "ovm",
        },
      ],
    });

    const result = resolveMapping(db, "m1", { now: new Date("2024-01-01T10:00:00") });
    expect(result!.configLevelTargetKeys!.has("p1:gpt-4o")).toBe(true);
    expect(result!.configLevelTargetKeys!.has("ovp:ovm")).toBe(true);
  });

  // TC6: expandOverflowTargets 派生 target 继承源 target 的 circuit_breaker（引用同一对象）
  it("TC6: expandOverflowTargets 派生溢出 target 继承源 target.circuit_breaker；源无配置则派生也无", () => {
    // 先插入 provider（provider_model_info 有外键约束 provider_id → providers.id）
    db.prepare(
      "INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "p1",
      "prov-tc6",
      "openai",
      "https://api.example.com",
      "sk-test",
      JSON.stringify(["small-model"]),
      1,
      new Date().toISOString(),
      new Date().toISOString(),
    );

    // 设极小 context_window，使任意非空 body 都触发溢出（estimated > 1 * 0.9）
    db.prepare(
      "INSERT INTO provider_model_info (provider_id, model_name, context_window) VALUES (?, ?, ?)",
    ).run("p1", "small-model", 1);

    const cb: CircuitBreakerConfig = {
      enabled: true,
      window_sec: 60,
      failure_rate: 0.9,
      min_samples: 10,
      cooldown_sec: 300,
    };
    const targetWithCb: Target = {
      backend_model: "small-model",
      provider_id: "p1",
      overflow_provider_id: "p2",
      overflow_model: "big-model",
      circuit_breaker: cb,
    };
    const body = { messages: [{ role: "user", content: "hello world, enough tokens to overflow tiny window" }] };

    const { targets, overflowIndices } = expandOverflowTargets([targetWithCb], db, body);
    // 派生溢出 target 排在源 target 之前
    expect(overflowIndices.has(0)).toBe(true);
    const derived = targets[0]!;
    expect(derived.provider_id).toBe("p2");
    expect(derived.backend_model).toBe("big-model");
    // 继承源 target 的 circuit_breaker（引用同一对象，非复制）
    expect(derived.circuit_breaker).toBe(cb);
    // 源 target 保留在第二位
    expect(targets[1]).toBe(targetWithCb);

    // 源 target 无 circuit_breaker → 派生 target 同样不带
    const targetNoCb: Target = {
      backend_model: "small-model",
      provider_id: "p1",
      overflow_provider_id: "p2",
      overflow_model: "big-model",
    };
    const result2 = expandOverflowTargets([targetNoCb], db, body);
    expect(result2.targets[0]!.circuit_breaker).toBeUndefined();
  });

  // TC7: configLevelTargetKeys 去重（base 与 schedule 同 provider:model 只计一次）
  it("TC7: configLevelTargetKeys 去重 - base 与 schedule 指向同 (provider, model) 时 Set 不重复", () => {
    insertGroup("g1", "m1", {
      targets: [{ backend_model: "gpt-4o", provider_id: "p1" }],
    });
    // schedule 不命中当前时间（2~4），但 configLevelTargetKeys 收集全部 schedule targets
    insertSchedule(
      "s1",
      "g1",
      JSON.stringify({ targets: [{ backend_model: "gpt-4o", provider_id: "p1" }] }),
      2,
      4,
    );

    const result = resolveMapping(db, "m1", { now: new Date("2024-01-01T10:00:00") });
    expect(result!.configLevelTargetKeys!.has("p1:gpt-4o")).toBe(true);
    // base 与 schedule 指向同一 key，去重后仅 1 个
    expect(result!.configLevelTargetKeys!.size).toBe(1);
  });
});

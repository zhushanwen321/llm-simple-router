---
phase: dev
verdict: pass
---

# Dev Phase Retrospect

## 1. Phase Execution Review

### Summary

Dev 阶段完成了 Pipeline 全量接管代理请求执行的核心迁移。从 failover-loop.ts（612 行 god function）中提取出 6 个内置 hook（route-resolve、format-transform、api-key-decrypt、transport-execute、stream-timeout、usage-record），建立了三层执行架构（L1 预计算 → L2 pipeline emit → L3 循环控制）。最终交付物：failover-loop.ts 缩减 40%（612→366 行），1492/1492 测试通过，tsc/eslint 零错误。编码评审经历 4 轮，4 条 MUST FIX 全部修复，9 条 LOW/INFO 保持 open（不阻塞）。

### Problems Encountered

**1. 编码评审 4 轮，4 条 MUST FIX 集中在前 2 轮。**

- **MUST FIX #1（on_error phase 未 emit）**：failover-loop 重写后 catch 块没有调用 `emit("on_error")`，违反 FR6。这说明 L3 循环控制的错误处理路径在实现时被遗漏——迁移时只关注了 happy path 的 emit 序列，异常路径被忽略。与 spec 阶段 Issue #2（异常传播缺失）是同一思维盲区的延续。
- **MUST FIX #2（Plugin 响应转换丢失）**：transport-execute hook 没有调用 `applyBeforeResponse/applyAfterResponse`，导致 plugin 的响应拦截功能失效。这是迁移时的逻辑遗漏——从 failover-loop 提取代码到 hook 时跳过了 plugin bridge 的响应回调。
- **MUST FIX #3（usage 重复记录）**：usage-record hook 和 failover-loop inline 代码都调用了 `recordRequest()`，导致每次请求重复写入。迁移不彻底的典型症状——新 hook 建立了但旧代码没删。
- **MUST FIX #4（unknown error 双重日志）**：v2 修复 #1 后引入的新问题。errorLoggingHook 和 inline `insertRequestLog` 都在 unknown error 路径插入 request_logs，且 tool errors 闭包被多次 flush。差异化策略解决：unknown error 走 emit on_error；Semaphore 错误不 emit（避免双重日志）。

**2. AC2 行数目标未完全达成。**

Spec 要求 failover-loop.ts ≤250 行，实际 366 行。根因是 Issue #4（requestLoggingHook 是 no-op）导致 inline 日志补偿代码无法删除。requestLoggingHook 读 `ctx.metadata.get("resilienceResult")`，但 transport-execute 写的是 `ctx.resilienceResult`，字段名不匹配。这不是设计决策而是字段命名不一致的 bug，修复成本极低但未在本轮处理。

**3. 9 条 LOW/INFO 跨 4 轮评审未修复。**

其中 #4（requestLoggingHook no-op）和 #7（import 残留）是连带问题，修复其中一个就能同时解决另一个。#5/#6（priority 偏移）是 spec 一致性问题，不影响运行。#12（flushToolErrors 闭包未置空）和 #13（ProviderSwitchNeeded snapshot 不完整）在 failover 场景下有实际影响但测试未覆盖到。

### What Would You Do Differently

1. **迁移应该用 checklist 驱动而非逐行搬运。** 4 条 MUST FIX 中有 3 条是"遗漏"而非"设计错误"：on_error emit、plugin 响应转换、usage 记录去重。如果从 failover-loop 中列出所有被迁移的调用点作为 checklist，每个调用点标注"新 hook 覆盖"或"inline 保留"，遗漏的概率大幅降低。

2. **PipelineContext 字段命名应该在 spec 阶段就建立映射表。** Issue #4 的根因是 `ctx.metadata.get("resilienceResult")` vs `ctx.resilienceResult` 的命名不一致。spec FR5 有字段映射表，但只列了"写入者→消费者"而没有列"字段名→存储位置（ctx 字段 vs ctx.metadata）"。如果映射表包含存储位置，这类命名不匹配在 plan 阶段就能被发现。

3. **LOW 问题应该区分"可延期"和"应立即修复"。** #4（requestLoggingHook no-op）直接导致 AC2 不达标和 #7（import 残留），修复成本极低（改一个字段名），但不修复则持续产生技术债。建议在评审中对 LOW 增加"修复成本"维度：成本 < 10 分钟 → 当轮修复。

### Key Risks

1. **requestLoggingHook no-op 持续存在（Issue #4）。** 当前日志/指标采集依赖 inline 补偿代码，如果未来有人清理 failover-loop 的 inline 代码时没有意识到 requestLoggingHook 是 no-op，会导致日志丢失。建议作为下一个迭代的 P0 修复。
2. **flushToolErrors 闭包未置空（Issue #12）。** failover 场景下 tool errors 可能被多次写入 request_logs。虽然概率低（需要 failover + tool call 错误同时发生），但一旦发生会产生脏数据。
3. **Plan 中 2 个测试文件未创建（Issue #9）。** pipeline-hooks.test.ts 和 pipeline-emit.test.ts 在 plan 中规划但未产出。当前 emit 降级由 pipeline-error-degradation.test.ts（6 个用例）覆盖，但 hook 级别的单元测试和 emit 序列集成测试缺失，增加了后续迭代回归的风险。
4. **failover-loop 实际仍承担了部分 L2 职责。** 366 行中 ~226 行是 inline 日志/指标补偿代码，本质上仍是 L2 逻辑。这意味着"三层分离"的架构目标只完成了核心部分（格式转换、transport、plugin），日志层仍需二次迁移。

---

## 2. Harness Usability Review

### Flow Friction

编码评审 4 轮属于可接受范围（spec 3 轮 + plan 5 轮的基线下），但存在效率问题：

1. **v2 引入了新 MUST FIX（#4 双重日志）。** 修复 #1 时没有考虑 inline 代码的叠加效应，导致 v2→v3 又发现一个回归。如果修复 MUST FIX 时执行"影响半径检查"（修改了 catch 块 → 检查同一路径上是否有其他日志写入点），可以在同轮内发现 #4。
2. **v4 是纯验证轮次。** 基于 test_results.md 的 AC 覆盖验证，没有发现新问题。这是合理的质量投入，不视为浪费。

### Gate Quality

编码评审准确识别了 4 条 MUST FIX，全部在 2 轮内修复。评审深度逐轮增加：v1 聚焦功能完整性（遗漏检查），v2 聚焦叠加效应（修复引入的回归），v3 聚焦边界场景（tool errors 闭包、snapshot 完整性），v4 聚焦测试证据验证。这种逐步深入的模式有效。

v3 新发现的 #12 和 #13 是真实问题（failover 场景下的边界 case），说明评审到了第 3 轮才覆盖到 failover 的异常组合路径。这暴露了评审方法论的盲区：当前评审主要验证"happy path 是否完整"和"单点错误是否修复"，但对"多个错误同时发生"的组合场景缺乏系统性覆盖。

### Prompt Clarity

Dev 阶段的执行依赖 plan 的 Task List 和 Execution Groups。plan 提供的 Subagent 配置表（注入上下文、读取文件、修改文件）为 subagent 提供了充分的起点信息，减少了探索成本。

一个可改进点：plan 的 Task 5（transport-execute）依赖列表只写了 "3, 4"，但实际运行时依赖 Task 2 的 route-resolve hook 写入 ctx.resolved。这个依赖在 plan review 中被标注为 LOW Issue #5 但未修复，dev 执行时依赖串行调度避免了问题，但如果并行执行会导致 subagent 失败。

### Automation Gaps

1. **AC2 行数验证可以自动化。** 当前依赖人工检查 failover-loop.ts 行数。可以通过 gate-script 检查文件行数是否达标，将 AC2 从"人工确认"变为"自动门禁"。
2. **import 残留检查可以自动化。** Issue #7（logResilienceResult/collectTransportMetrics 仍在 import）可以通过 grep 检查指定文件是否仍包含特定 import，作为 gate 的附加检查项。

### Time Sinks

4 轮编码评审是主要时间消耗。其中 v1→v2 修复 3 条 MUST FIX 是必要的，v2→v3 修复 1 条 MUST FIX 是 v2 修复引入的回归（本可避免），v3→v4 是纯验证（合理投入）。如果修复 MUST FIX 时执行影响半径检查，总轮次可缩减到 3 轮。

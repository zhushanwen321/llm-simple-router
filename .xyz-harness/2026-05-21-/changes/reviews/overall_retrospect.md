---
phase: pr
verdict: pass
---

# Overall Retrospect — Pipeline 全量接管代理请求执行

## 1. Phase Execution Review

### Summary

本次需求将 failover-loop.ts（612 行 god function）拆为三层执行架构（L1 预计算 / L2 pipeline emit / L3 循环控制），提取 6 个内置 hook，建立 pipeline 全量接管代理请求的执行模型。历经 5 个 phase，最终交付：failover-loop.ts 缩减 40%（612→366 行），1534 测试全部通过，CI 绿色，PR #162 合并就绪。

**关键指标：**

| 指标 | 数值 |
|------|------|
| 评审总轮次 | spec 3 + plan 5 + dev 4 + test 1 + pr 1 = 14 轮 |
| MUST FIX 总数 | 9 条（spec 3 + plan 2 + dev 4 + test 0 + pr 0） |
| LOW/INFO 积压 | ~20 条（跨阶段累积，不阻塞合并） |
| 测试增长 | 1492→1534（+42 条新增，+6 个测试文件） |
| 交付文件 | 6 个新 hook + 6 个新测试文件 + pipeline 降级测试 |
| failover-loop 缩减 | 612→366 行（-40%，AC2 ≤250 行未达标） |

### Phase-by-Phase 回顾

#### Spec（3 轮评审，3 条 MUST FIX）

**做对了什么：** 产出结构完整（7 FR / 8 AC / 8 Constraint / 8 Out of Scope），三层架构的设计决策合理，6 个 hook 的 phase/priority 归属清晰。

**核心问题：** 3 条 MUST FIX 全部是"遗漏"而非"设计争议"——异常传播机制缺失、L1/L2 职责边界表述模糊、on_stream_event 自相矛盾。如果 spec 完成后有轻量自检（"是否覆盖错误路径？FR 之间有无职责重叠？Constraint 之间有无矛盾？"），这 3 条可以避免。第 3 轮新发现的 Issue #13（pre_route 向后兼容）说明评审缺乏兼容性固定检查项。

**遗留风险：** 迁移策略未定义（~15 文件一次性提交回滚困难）、AC5 等价验证方法缺失、性能无阈值。

#### Plan（5 轮评审，2 条 MUST FIX）

**做对了什么：** 9-task / 3-group 的拆解粒度合理，Execution Groups 的 Subagent 配置表（注入上下文/读取文件/修改文件）直接支撑了 dev 阶段的 subagent 执行。E2E 测试 20 场景 + 16 个 TC 模板覆盖面广。

**核心问题：** MUST FIX #1（transport-execute priority 排序暗示错误）是文档精度问题，MUST FIX #2（≤150 行目标不可行）是 AC 可行性验证缺失。两个问题都可以通过 plan 自检清单拦截。4 条 LOW 从 v1 积压到 v5 未修复，其中 #5（Task 5 运行时依赖未在 Depends on 中体现）和 #6（on_error ctx 字段缺失）对执行有实际影响，不应长期 open。

**遗留风险：** Task 5 对 Task 2 的隐式运行时依赖、on_error 分支 ctx 字段不完整。

#### Dev（4 轮评审，4 条 MUST FIX）

**做对了什么：** 6 个 hook 实现完整，pipeline emit 降级（非核心 hook 异常不阻塞请求）设计合理。1492 测试全部通过证明迁移未破坏现有功能。subagent 按 Execution Groups 分批执行，串行调度避免了 plan 中隐式依赖的问题。

**核心问题：** 4 条 MUST FIX 中 3 条是迁移遗漏（on_error emit / plugin 响应转换 / usage 重复记录），根因是迁移用"逐行搬运"而非 checklist 驱动。MUST FIX #4 是修复 #1 时引入的回归（双重日志），说明修复缺乏影响半径检查。AC2（≤250 行）未达标（实际 366 行），根因是 requestLoggingHook 因字段命名不匹配成为 no-op，inline 补偿代码无法删除。

**遗留风险：** requestLoggingHook no-op（Issue #4）导致日志层二次迁移需求、flushToolErrors 闭包未置空（failover 边界 case）、plan 中 2 个测试文件未创建。

#### Test（1 轮评审，0 条 MUST FIX）

**做对了什么：** 16 个 TC（38 个子测试）结构清晰，断言充分，mock 边界合理。测试文件按 hook 拆分（而非 plan 的按功能大类拆分），更利于维护。全量回归 1534/1534 通过。

**核心问题：** AC3/AC5/AC6 三项部分覆盖。AC5 的 10 种场景等价性仅 1/10 有显式端到端验证，其余依赖现有测试隐式覆盖。测试未发现 dev 阶段遗留的 requestLoggingHook no-op 问题——因为测试只验证了"日志被写入"，没有验证"日志通过 hook 还是 inline 代码写入"。

**遗留风险：** overflow-redirect / provider-patches 执行未验证、9 种场景无新增显式测试。

#### PR（1 轮评审，0 条 MUST FIX）

**做对了什么：** 合并前门禁三条件（编码评审通过 + 测试评审通过 + CI 通过）全部满足。PR 标题准确反映变更内容，CI 在 Node 18/20 双版本 + Docker 全部绿色。评审验证了 Pipeline Hook 注册路径合规性和数据消费者完整性。

**核心问题：** 无。PR 阶段是纯验证阶段，前置 phase 的充分准备使其 1 轮通过。

### Problems Encountered（跨阶段汇总）

**1. "遗漏"是 MUST FIX 的主因，9 条中 8 条是遗漏。**

| MUST FIX | 类型 | 阶段 |
|----------|------|------|
| spec #1 职责重叠 | 文档遗漏 | spec |
| spec #2 异常传播 | 设计遗漏 | spec |
| spec #3 自相矛盾 | 自检遗漏 | spec |
| plan #1 priority 排序 | 文档精度 | plan |
| plan #2 行数目标 | 验证遗漏 | plan |
| dev #1 on_error emit | 迁移遗漏 | dev |
| dev #2 plugin 响应 | 迁移遗漏 | dev |
| dev #3 usage 去重 | 迁移遗漏 | dev |
| dev #4 双重日志 | 回归引入 | dev |

9 条 MUST FIX 中只有 dev #4 是"修复引入的回归"，其余 8 条都是"应该想到但没想到"。这说明当前流程的薄弱环节不是设计能力，而是自检纪律。

**2. LOW 问题跨阶段积压，形成技术债。**

~20 条 LOW/INFO 从各阶段累积，从未被系统性清理。其中部分对后续迭代有实际影响：
- dev #4（requestLoggingHook no-op）直接导致 AC2 不达标
- plan #5（隐式依赖）在并行化时会导致运行时错误
- dev #12（flushToolErrors 闭包）在 failover 边界 case 下产生脏数据

**3. AC2 行数目标从 plan 到 dev 连续未达标。**

plan 最初设 ≤150 行 → 评审调整为 ≤250 行 → dev 实际 366 行。根因链：requestLoggingHook 字段命名不匹配 → hook 成 no-op → inline 日志补偿代码无法删除 → 额外 ~100 行。这是一个典型的"小 bug 级联"问题——一个字段命名不一致最终导致架构目标偏差。

### What Would You Do Differently

1. **每个 phase 增加轻量自检清单。** 9 条 MUST FIX 中 8 条可以通过结构化自检拦截：

   - Spec 自检：错误路径覆盖？FR 间职责重叠？Constraint 间矛盾？向后兼容性？
   - Plan 自检：关键数值（行数/priority）有依据？AC 可行性验证？隐式依赖标注？
   - Dev 自检：迁移 checklist（每个调用点标注"新 hook 覆盖"或"inline 保留"）？字段命名一致性？修复影响半径？

2. **LOW 问题按"修复成本"分级，低成本当轮修复。** 当前所有 LOW 统一积压，但 dev #4（改一个字段名，10 分钟）和 plan #3（改一个数字，2 分钟）的修复成本极低，积压反而增加了后续每轮评审的确认开销。

3. **PipelineContext 字段映射表应该在 spec 阶段就包含存储位置。** `ctx.metadata.get("resilienceResult")` vs `ctx.resilienceResult` 的不一致在 spec 阶段就可以发现，避免了 dev 阶段的 no-op bug 和 AC2 偏差。

4. **AC5 等价验证方法应该在 plan 阶段就明确定义。** Spec 留了口子（"10 种场景的等价性"），plan 没有定义验证方法，test 阶段就只能依赖现有测试隐式覆盖。如果 plan 阶段把 10 种场景分为"新增 TC 验证"和"依赖现有测试"两类，test 的覆盖判断会更有依据。

### Key Risks（合并后需关注）

1. **requestLoggingHook no-op（P0 修复）。** 当前日志/指标采集完全依赖 inline 补偿代码。如果后续清理 failover-loop 时误删 inline 代码，会导致日志丢失。合并后应立即修复字段命名不匹配问题，激活 requestLoggingHook，删除 inline 补偿代码，将 failover-loop 进一步缩减至 ≤250 行。

2. **flushToolErrors 闭包未置空（P1 修复）。** failover + tool call 错误同时发生时 tool errors 可能被多次写入。概率低但会产生脏数据，应作为下一迭代修复。

3. **AC5 的 9 种场景无显式测试。** 后续 pipeline 行为变更时，这 9 种场景的回归依赖现有 1534 测试隐式覆盖。如果现有测试不够细，回归可能在生产环境才暴露。

4. **pre_route 向后兼容。** 外部插件已注册的 pre_route hook 在新 pipeline emit 序列中不再被调用。虽然当前无外部插件，但如果未来有用户自定义 hook 注册到 pre_route phase，需要明确的迁移指引。

---

## 2. Harness Usability Review

### Flow Friction

**总评审 14 轮偏多，但分布合理。** Spec 3 轮 + Plan 5 轮偏重，Dev 4 轮可接受，Test 1 轮 + PR 1 轮高效。从趋势看，前期阶段（spec/plan）的充分投入减少了后期阶段（test/pr）的返工——如果 spec/plan 评审不够严格，dev/test 阶段会需要更多轮次来弥补。

主要摩擦点：

1. **Plan 5 轮是最大摩擦。** 其中 v3-v5 为质量保证轮次（确认修复无回归 + 独立复查），属于合理的质量投入，但对 AI 执行效率影响大——每轮评审需要完整重读 plan 文档。如果评审方法论支持"增量审查"（只审变更部分而非全量重审），3 轮可能足够。

2. **Dev 阶段的 MUST FIX #4（v2 引入的回归）是浪费的摩擦。** 修复 #1 时没有检查同一路径上的其他写入点，导致 v2→v3 又发现新问题。如果修复 MUST FIX 时增加"影响半径检查"步骤（修改了 catch 块 → 检查同一路径是否有其他日志写入点），可以省掉 1 轮。

3. **Phase 间衔接顺畅。** Spec→Plan、Plan→Dev、Dev→Test、Test→PR 的交接没有出现"前序阶段的关键信息在后序阶段丢失"的情况。Plan 的 Execution Groups 配置表（注入上下文/读取文件/修改文件）对 dev 阶段特别有价值。

### Gate Quality

**Gate 检查整体有效，无 false positive。** 14 轮评审共发现 9 条 MUST FIX，全部是真实问题。评审的深度逐轮增加（v1 聚焦功能完整性 → v3 聚焦边界场景 → v4/v5 聚焦修复确认），说明方法论本身有效。

**但存在覆盖盲区：**

1. **组合异常场景缺乏系统性覆盖。** Dev 阶段的 v3 才发现 flushToolErrors 闭包和 ProviderSwitchNeeded snapshot 的边界问题，说明评审方法论的"错误组合"维度缺失。当前评审主要检查"happy path 完整"和"单点错误修复"，对"多个错误同时发生"缺乏检查项。

2. **字段命名一致性未纳入评审维度。** `ctx.metadata.get("resilienceResult")` vs `ctx.resilienceResult` 的不一致在 spec/plan/dev 三个阶段都未被评审捕获，直到 dev 阶段以"AC2 不达标"的形式暴露。这说明评审缺乏"数据契约一致性"检查项。

3. **测试评审对"测试深度"的校准偏宽松。** AC5 的 10 种场景仅 1/10 有显式验证，评审标 INFO 而非 MUST FIX。这个判定是否合理取决于对"功能等价"的严格程度——如果等价意味着"每个场景都有断言证明"，则 AC5 实际未满足。

### Prompt Clarity

**各阶段的 prompt/模板质量良好：**

- Spec 模板（Background → FR → AC → Constraint → Out of Scope）结构清晰，产出一致。
- Plan 的 Execution Groups 和 Subagent 配置表直接支撑了 subagent 执行，减少了上下文准备成本。
- Test 的 test_cases_template.json 为每个 TC 提供了明确的输入/输出/断言定义。
- PR 的合并前门禁检查清单（三条件）清晰可操作。

**可改进点：**

- Plan 的 Self-Review section 缺乏"数值验证"维度（行数目标依据、priority 排序验证）。
- Spec 的 FR 字段映射表应增加"存储位置"列（ctx 字段 vs ctx.metadata）。
- Test 的 TC-8-01（行数检查）和 TC-8-04（全量测试通过）本质上是静态检查，不适合作为功能 TC。

### Automation Gaps

**3 类检查应从人工验证转为自动门禁：**

1. **AC2 行数/import 检查。** `wc -l failover-loop.ts` + `grep "import.*logResilienceResult"` 可以完全自动化，当前每次评审都人工重复。
2. **全量测试/tsc/eslint 结果收集。** `npm test && tsc --noEmit && eslint` 的输出应自动写入 test_results.md，而非人工粘贴。
3. **Spec→Plan 覆盖矩阵。** 逐条 FR/AC 到 Task 的映射关系是结构化的，可以脚本生成初稿，评审只需确认。

**评审轮次的增量 diff 也可以自动化。** 当前每轮评审需要全量重读 plan/spec 文档。如果评审工具能自动高亮上一轮以来的变更，可以大幅减少评审的 token 消耗和时间。

### Time Sinks

**评审是最大的时间消耗（14 轮），但分布不均：**

- Plan 5 轮是单个阶段的最大消耗。其中 v1→v2 的 2 条 MUST FIX 修复是必要的，但 v3-v5 的确认轮次占 3 轮。如果评审支持增量审查，可以缩减到 3 轮。
- Dev 4 轮中 1 轮（v2→v3 修复回归）是浪费的，本可通过影响半径检查避免。
- Test 1 轮 + PR 1 轮的高效率证明了前置阶段（spec/plan/dev）充分投入的价值。

**另一类时间消耗是 LOW 问题的反复确认。** ~20 条 LOW/INFO 在每轮评审中都需要检查状态，但绝大多数从未被修复。如果评审工具能过滤"未变更的 open LOW"，只高亮新发现和状态变化的问题，可以减少每轮评审的噪音。

### Harness 总体评价

**xyz-harness 在这个需求上的表现：有效但偏重。**

- **有效性**：9 条 MUST FIX 在合并前全部修复，0 条 false positive，CI 全绿。合并前门禁的三条件检查阻止了不完整代码进入 main。
- **偏重性**：14 轮评审对 AI 执行效率影响大。其中约 4-5 轮可以通过自检清单、增量审查、自动化 gate 来消除。
- **技术债管理**：~20 条 LOW/INFO 的积压是 harness 的系统性短板。当前流程只有"PASS/FAIL"二元判定，缺乏"带条件通过 + 跟踪项"的中间状态，导致 LOW 要么升级为 MUST FIX 要么永远 open。

**建议的 harness 改进（按优先级）：**

1. **自检清单**：各 phase 产出提交评审前，执行固定自检项（错误路径、数值依据、命名一致性）。
2. **增量评审**：评审只读上一轮以来的 diff，不全量重审。
3. **技术债跟踪**：LOW 问题标注修复成本，< 10 分钟的当轮修复；其余进入 TODO 列表，N 轮未修复自动升级为 MUST FIX。
4. **自动化 gate**：行数/import 检查、测试结果收集、覆盖矩阵生成脚本化。

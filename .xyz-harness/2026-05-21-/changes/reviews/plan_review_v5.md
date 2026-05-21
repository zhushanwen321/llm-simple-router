---
verdict: pass
must_fix: 0
review:
  type: plan_review
  round: 5
  timestamp: "2026-05-22T23:59:00"
  target: ".xyz-harness/2026-05-21-/plan.md"
  summary: "计划评审v5独立复查完成，v4已验证的0条MUST FIX保持已解决状态，4条LOW问题仍open无变化，无新增问题，评审通过"
statistics:
  total_issues: 9
  must_fix: 0
  must_fix_resolved: 0
  low: 4
  info: 0
issues:
  - id: 1
    severity: MUST_FIX
    location: "plan.md:Task 5 + spec.md:FR3"
    title: "builtin:transport-execute priority 导致 pre_transport 阶段执行顺序错误"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 2
    severity: MUST_FIX
    location: "plan.md:BG2 Task 8 + spec.md:AC2"
    title: "failover-loop 缩减至 ≤150 行的目标不可行，实际预估 ~200-240 行"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 3
    severity: LOW
    location: "plan.md:BG1 Files (预估)"
    title: "BG1 文件数文字描述（13个）与 File Structure 表格（10个）不一致"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 4
    severity: LOW
    location: "plan.md:BG1 Execution Flow"
    title: "BG1 串行执行 7 个 Task 过于保守，Tasks 2/3/4/6 可并行"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 5
    severity: LOW
    location: "plan.md:Task 5 Depends on"
    title: "Task 5 依赖列表不完整，遗漏了对 Task 2 (route-resolve) 的运行时数据依赖"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 6
    severity: LOW
    location: "plan.md:Task 8 设计细节"
    title: "on_error hook 在不同 catch 分支中的 ctx 字段准备不完整"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 7
    severity: INFO
    location: "plan.md:Constraint 8 设计细节"
    title: "Pipeline emit 异常降级的 priority < 100 判断依赖 hook 实例属性"
    status: dismissed
    raised_in_round: 1
    resolved_in_round: 2
  - id: 8
    severity: MUST_FIX
    location: "plan.md:Task 5 (L142-157) + Task 7 (L164-166) + spec.md:Constraint 8"
    title: "transport-execute 的 core: true 设置在 plan 中缺少显式指令"
    status: resolved
    raised_in_round: 2
    resolved_in_round: 4
  - id: 9
    severity: LOW
    location: "plan.md:File Structure + Task 1"
    title: "types.ts 归属 BG2 但 Task 1 (BG1) 需修改其 PipelineHook 接口，分组分配不一致"
    status: resolved
    raised_in_round: 3
    resolved_in_round: 4
---

# 计划评审 v5 — 独立复查

## 评审记录
- 评审时间：2026-05-22 23:59
- 评审类型：计划评审（第 5 轮，独立复查）
- 评审对象：`.xyz-harness/2026-05-21-/plan.md`（含 spec.md、e2e-test-plan.md、test_cases_template.json）

---

## 1. spec 完整性（独立复查）

**结论：完整，无新增问题。**

spec.md 目标清晰（三层架构解耦 failover-loop）、范围合理（明确 Out of Scope 含 on_stream_event 深度集成、DB 层重构等）、8 条 AC 均可测试验证。无 `[待决议]` 项。

spec Complexity Assessment 标注为"高"并说明了风险区域（failover 循环错误分类、stream transport 结果传递、PipelineContext 字段填充时序），对实现者有充分的预警。

---

## 2. plan 可行性（独立复查）

### 2.1 任务拆分粒度

| Task | 职责 | 预估行数 | 是否可独立完成 |
|------|------|---------|--------------|
| 1 | Pipeline.emit 异常降级 | ~40 行 | ✅ 自包含（修改 pipeline.ts emit()） |
| 2 | builtin:route-resolve | ~80 行 | ✅ 自包含，读取 ctx.metadata 写入 ctx.resolved |
| 3 | builtin:format-transform | ~60 行 | ✅ 自包含，从 failover-loop 提取 resolveUpstreamPath |
| 4 | builtin:api-key-decrypt | ~30 行 | ✅ 自包含，带请求级缓存 |
| 5 | builtin:transport-execute | ~100 行 | ✅ 最复杂 hook，但有明确输入输出契约 |
| 6 | builtin:stream-timeout + usage-record | ~40 行 | ✅ 各 <20 行，简单 |
| 7 | 注册新 hook | ~20 行 | ✅ 纯配置操作 |
| 8 | failover-loop 重写 | ~150 行 | ✅ 需依赖 BG1 产出 |
| 9 | 端到端验证 | 修复 | ✅ 验证性 task |

所有 task 粒度适中，可由 subagent 独立完成。

### 2.2 依赖关系正确性

```
Task 1-6 (par BG1, no internal deps)
  → Task 7 (register hooks, depends on 2-6)
    → Task 8 (failover rewrite, depends on 1, 7)
      → Task 9 (e2e verify, depends on 8)
```

主线依赖正确。Task 5 的 Depends on 标注为 "3, 4"（代码依赖），但运行时数据依赖 Task 2 的 ctx.resolved/ctx.provider——Issue #5 已标注此问题（LOW）。

### 2.3 工作量估算

| Group | 文件数 | Task 数 | 评估 |
|-------|-------|---------|------|
| BG1 | ~10 文件 | 7 | 合理。6 个 hook + 1 个 pipeline 修改 + 1 个注册 + 1 个测试 |
| BG2 | ~5 文件 | 1 | 合理。failover-loop 重写是最大工作 |
| BG3 | 0-2 文件 | 1 | 修复回归 |

工作量估算与现实匹配。

### 2.4 遗漏 Task 检查

对照 spec 逐条覆盖：

| Spec Section | 覆盖 Task | 判断 |
|-------------|----------|------|
| FR1 三层架构 | Task 8 | ✅ |
| FR2 Pipeline 驱动 L2 | Task 8 | ✅ |
| FR3 核心步骤 hook | Task 2-6 | ✅ |
| FR4 消除内联重复 | Task 8 | ✅ |
| FR5 PipelineContext 字段 | Task 2-6 + Task 8 | ✅ |
| FR6 on_error 接入 | Task 8 | ✅ |
| FR7 on_stream_event 就绪 | 故意无 task | ✅ 在 Out of Scope |
| AC1 全量接管 | Task 8 | ✅ |
| AC2 ≤250 行 | Task 8 | ✅（plan 目标 ≤150 更严） |
| AC3 已有 hook 激活 | Task 8 | ✅ |
| AC4 核心 hook 可执行 | Task 2-5 | ✅ |
| AC5 10 场景等价 | Task 9 | ✅ |
| AC6 日志指标等价 | Task 9 | ✅ |
| AC7 现有测试通过 | Task 9 | ✅ |
| AC8 pipeline 扩展 | Task 8 | ✅ |
| Constraint 8 异常降级 | Task 1 | ✅ |

**无遗漏。**

---

## 3. spec 与 plan 一致性

### 3.1 plan 覆盖 spec 所有需求项

逐条已在 2.4 完成，全覆盖。

### 3.2 plan 中的额外工作

plan 中无 spec 未提及的额外工作。ctx.metadata key 列表（cachedTargets、excludeTargets 等）是 L1→L2 的实现细节，隐含在 spec FR5 的 "所有 hook 通过 PipelineContext 通信" 中。

### 3.3 验收标准与 plan Task 对应

所有 AC 在 plan 中均有对应 Task。AC5（10 场景）映射到 Task 9，AC2（≤250 行）映射到 Task 8（plan 目标 ≤150 行更严格）。

**一致性检查：通过。**

---

## 4. Execution Groups 合理性

### 4.1 分组合理性

| Group | Task 数 | 文件数 | 是否合理 |
|-------|---------|-------|---------|
| BG1 | 7 | ≤10 | ✅ 功能关联紧密（全套 hook 基础设施） |
| BG2 | 1 | ~5 | ✅ 单一职责（failover-loop 重写） |
| BG3 | 1 | 0-2 | ✅ 验证性质 |

每组文件数 ≤10，通过。

### 4.2 类型划分

所有 Task 均为 backend，整个 plan 无前端 Task。分组无混合类型问题。

### 4.3 功能关联度

BG1 的 7 个 Task 高度关联（pipeline 降级机制 + 6 个新 hook + 注册），不应拆分。BG2 的 failover-loop 重写是 BG1 的唯一消费者。BG3 是验证收尾。

### 4.4 依赖关系

```
BG1 ──→ BG2 ──→ BG3
```

依赖正确。BG1 的 Task 1 (pipeline emit 降级) 在 Task 2-6 之前执行，符合逻辑——emit 降级机制先就绪，hook 开发过程中可能触发异常，降级机制已就位。

### 4.5 Wave 编排

| Wave | Groups | 并行性 |
|------|--------|--------|
| Wave 1 | BG1 | 单组，串行 |
| Wave 2 | BG2 | 单组，依赖 BG1 |
| Wave 3 | BG3 | 单组，依赖 BG2 |

Wave 编排合理。每组为串行依赖，不可并行。

### 4.6 Subagent 配置完整性

| Group | Agent | Model | 注入上下文 | 读取文件 | 修改/创建文件 |
|-------|-------|-------|-----------|---------|-------------|
| BG1 | general-purpose | 自动选择 | spec FR3, Constraint 8, FR5 | 明确列出 | 明确列出 |
| BG2 | general-purpose | 按复杂自动 | spec FR1,FR2,FR4,FR5,FR6, AC2,AC5 | 明确列出 | 明确列出 |
| BG3 | general-purpose | 按复杂自动 | spec AC1-AC8 | 明确列出 | 仅修复 |

每组配置完整。

### 4.7 上下文充分性

BG1 注入上下文包含 spec FR3（核心步骤 hook 列表）、Constraint 8（异常降级）、FR5（PipelineContext 字段映射），充分。

BG2 注入上下文包含 5 个 FR + 2 个 AC，充分。

BG1 读取文件列表包含 `failover-loop.ts`（提取逻辑源头）、`transport-fn.ts`、`orchestrator.ts`（transport-execute hook 的依赖），完整。

### 4.8 文件数预估准确性

**Issue #3（LOW，仍 open）：** BG1 描述 "13 个文件（7 create + 3 modify + 1 test + 2 test-create）" 与 File Structure 表格的实际 BG1 计数（6 create + 3 modify + 1 test-create = 10 个文件）不一致：
- 描述 7 个 create vs 实际 6 个
- 描述 "1 test" 分类实际不存在
- 描述 2 个 test-create vs 实际 1 个

数字差异不影响执行，但文档精度有优化空间。

---

## 5. E2E Test Plan 交叉验证

### 5.1 AC 覆盖矩阵

| AC | E2E 场景 | 覆盖状态 | 测试位置 |
|----|---------|----------|---------|
| AC1 | E2E-01/02/03 | ✅ | e2e-test-plan Scenario Group 1 |
| AC2 | 静态检查 (TC-8-01) | ✅ | test_cases_template.json |
| AC3 | E2E-17/18/19 | ✅ | e2e-test-plan Scenario Group 4 |
| AC4 | E2E-08 | ✅ | e2e-test-plan Scenario Group 2 |
| AC5 | E2E-04~13 | ✅ | e2e-test-plan Scenario Group 2 |
| AC6 | E2E-14/15/16 | ✅ | e2e-test-plan Scenario Group 3 |
| AC7 | 全部通过 | ⚠️ | 由 TG-8-04 (npm test) 验证，e2e-test-plan 未单独列出 E2E 场景 |
| AC8 | E2E-20 | ✅ | e2e-test-plan Scenario Group 5 |

**观察：** AC7 的覆盖方式合理——现有 40 个测试文件的回归检测由 `npm test` 保证，不需要额外 E2E 场景。测试通过标准清晰。

### 5.2 test_cases_template.json 覆盖

test_cases_template.json 包含 16 个测试用例：
- TC-1-01/02: AC1 验证（Pipeline emit phase 覆盖）
- TC-2-01/02: FR3 route-resolve hook 测试
- TC-3-01: FR3 format-transform hook 测试
- TC-4-01: FR3 api-key-decrypt hook 测试
- TC-5-01: FR3 transport-execute hook 测试
- TC-6-01/02: FR3 stream-timeout + usage-record 测试
- TC-7-01: 注册验证
- TC-8-01/02/03/04: BG2 failover-loop 验证 + 回归
- TC-9-01/02: AC8 扩展性验证 + PipelineAbort 短路

16 个测试用例覆盖了 FG1-FG3 的主要验证点。E2E test plan 中的 AC5 10 场景（E2E-04~13）在 TC 中部分映射到 TC-8-02（failover）/TC-8-03（ProviderSwitchNeeded）和 TC-3-01（跨格式转换），其余场景（OpenAI 基本流、Anthropic 基本流、溢出重定向等）可复用现有测试或由 BG3 新增。

---

## 6. 后端设计充分性（L1）

### 6.1 "为什么"而非仅"做什么"

| Task | 是否说明了"为什么" | 说明 |
|------|-----------------|------|
| Task 1 | ✅ | emit 降级原因：核心 hook 不可降级，非核心异常不阻塞后续 |
| Task 2 | ✅ | 从 failover-loop L185-L210 提取，L1 已完成映射 |
| Task 3 | ✅ | resolveUpstreamPath 逻辑提取 |
| Task 4 | ✅ | 带请求级缓存的解密，避免重复解密 |
| Task 5 | ✅ | Priority 300 的原因：确保所有改造/插件完成后执行 |
| Task 8 | ✅ | 三层架构（L1+L3 循环壳，L2 pipeline emit） |

充分。

### 6.2 存储变更

无新增存储变更。所有 L1→L2 数据传递通过 ctx.metadata（内存 Map）完成，无需 DB 表变更或新增字段。选型理由隐含：避免迁移负担，数据生命周期与请求一致。

### 6.3 API 端点设计

无新增 API 端点。纯内部重构。

### 6.4 边界条件与异常处理

Plan 中覆盖了以下异常路径：
- PipelineAbort → return reply (code, body)
- ProviderSwitchNeeded → exclude + continue
- SemaphoreQueueFull / SemaphoreTimeout → on_error + rejectAndReply
- AbortError → return reply (空响应)
- Unknown error → on_error + 502

**Issue #6（LOW，仍 open）：** SemaphoreQueueFull/SemaphoreTimeout 分支和 unknown error 分支都 emit("on_error")，但此时 ctx.transportResult/resilienceResult 可能未填充（请求尚未到达 transport-execute hook）。on_error hook 的消费者（request-logging）需要防御性地处理缺失字段。当前 plan 未明确 on_error hook 对 ctx 字段缺失的防卫逻辑。建议 BG2 实现 note 中添加对此场景的说明。

### 6.5 非功能性要求

- 性能不退化（Constraint 6）：hook 执行是同步调用链，无额外异步调度。合理。
- Hook 异常降级（Constraint 8）：core 标记 + priority < 100 双重判定。合理。
- 向后兼容（Constraint 3）：API 行为不变。合理。

---

## 7. v4 修复验证汇总

| Issue | v4 状态 | v5 状态 | 说明 |
|-------|--------|--------|------|
| #8 transport-execute core: true 显式指令 | resolved (v4) | resolved | Task 5 和 Task 7 均包含 `core: true` 说明 |
| #9 types.ts 分组归属 | resolved (v4) | resolved | File Structure 中 types.ts 已移至 BG1 |

v4 确认的两个修复仍有效。代码未回退。

---

## 结论

**通过。** v4 的 0 条 MUST FIX 保持已解决状态。v5 独立复查未发现新的 MUST FIX。4 条 LOW 问题（Issue #3/#4/#5/#6）均为文档精度优化，不阻塞流程。

---

### Summary

计划评审v5独立复查完成，v4已验证的0条MUST FIX保持已解决状态，4条LOW问题仍open无变化，无新增问题，评审通过。

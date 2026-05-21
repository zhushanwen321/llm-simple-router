---
verdict: pass
must_fix: 0
review:
  type: plan_review
  round: 3
  timestamp: "2026-05-21T22:00:00"
  target: ".xyz-harness/2026-05-21-stream-db-streamts-terminal-extra/spec.md + plan.md + e2e-test-plan.md + test_cases_template.json"
  verdict: pass
  summary: "计划评审完成，第3轮，0条MUST FIX（open），3条LOW，1条INFO，建议进入编码阶段"

statistics:
  total_issues: 6
  must_fix: 0
  must_fix_resolved: 1
  low: 3
  info: 1

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md:AC6, e2e-test-plan.md:TS5"
    title: "AC6/TS5 缺少 failover_retry 映射原因的测试覆盖（已修复）"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 2
    severity: LOW
    location: "plan.md:BG1 Execution Groups — 文件数"
    title: "BG1 文件数标注不准确（10 vs 9）"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 3
  - id: 3
    severity: LOW
    location: "spec.md:AC4, plan.md:Task 3, e2e-test-plan.md:TS3"
    title: "headers_sent 的 0 与 NULL 区分标准未定义"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 4
    severity: LOW
    location: "plan.md:Task 3 Step 4"
    title: "failoverTrigger 提取方式与 spec FR7 不一致（instanceof vs constructor.name）"
    status: open
    raised_in_round: 2
    resolved_in_round: null
  - id: 5
    severity: INFO
    location: "test_cases_template.json: TC-6"
    title: "test_cases_template.json 缺少 overflow_redirect 专用测试用例"
    status: open
    raised_in_round: 2
    resolved_in_round: null
  - id: 6
    severity: LOW
    location: "plan.md:Task 3 Step 3"
    title: "Success 路径（insertSuccessLog）的数据来源未指定"
    status: open
    raised_in_round: 3
    resolved_in_round: null
---

# 计划评审 v3

## 评审记录
- 评审时间：2026-05-21 22:00
- 评审类型：计划评审（第 3 轮）
- 评审对象：`spec.md` + `plan.md` + `e2e-test-plan.md` + `test_cases_template.json`

---

## 0. 轮次说明

这是第 3 轮评审（上限 3 轮）。按方法论，本轮基于当前交付物独立判断，并继承前两轮的问题列表，更新状态。

---

## 1. Spec 完整性

### 目标明确性 ✅
目标清晰：持久化 8 类诊断数据 + 修复前端超时 UI，一段话能说清楚。

### 范围合理性 ✅
范围控制严格。8 个列均为 NULLABLE，无需迁移。SSE 推送、Admin API 过滤、前端日志展示、历史数据回填全部标注 Out of Scope。风险可控。

### 验收标准可量化 ✅
AC1-AC8 均包含具体字段值断言，可直接写测试。

### 待决议项
无 `[待决议]` 标记。

---

## 2. Plan 可行性

### 任务拆分合理性 ✅
5 个 Task 粒度适中：DB 层（Task 1）→ 类型层（Task 2）→ 数据流串联（Task 3）→ 端到端测试（Task 4）→ 前端 UI（Task 5）。依赖关系正确。

### 依赖关系正确性 ✅
Task 1 → 2 → 3 → 4 正确。Task 5 独立。BG1 内部依赖链清晰，无循环依赖。

### 工作量估算 ✅
BG1: 9 个文件（2 create + 7 modify），FG1: 1 个文件。与项目规模匹配。

### 遗漏 Task 检查

逐条对照 spec FR1-FR8：

| FR | 对应 Task | 状态 |
|----|----------|------|
| FR1: transport_kind | Task 1 (DB) + Task 2 (type) + Task 3 (wire) | ✅ |
| FR2: abort_reason | Task 2 (type) + Task 3 (wire) | ✅ |
| FR3: error_code | Task 2 (type) + Task 3 (wire) | ✅ |
| FR4: headers_sent | Task 2 (type) + Task 3 (wire) | ✅ |
| FR5: resilience decision | Task 2 (type) + Task 3 (wire) | ✅ |
| FR6: mapping_reason | Task 3 (wire) | ✅ |
| FR7: failover_trigger | Task 3 (wire) | ⚠️ 见 #4 |
| FR8: UI fix | Task 5 | ✅ |

未发现遗漏的 Task。

---

## 3. Spec 与 Plan 一致性

### 需求覆盖 ✅
Plan 覆盖 spec 所有需求项。`insertSuccessLog` 路径扩展是 spec 未明确提及但 architecture 要求的必要补全，plan 正确识别。

### AC 覆盖测试计划

| AC | 场景 | 覆盖状态 | 位置 |
|----|------|---------|------|
| AC1: transport_kind 6 种 | TS1 (6 场景) | ✅ | e2e-test-plan |
| AC2: abort_reason 4 种 | TS2 (4 场景) | ✅ | e2e-test-plan |
| AC3: error_code | TS3 (2 场景) | ✅ | e2e-test-plan |
| AC4: headers_sent | TS3 (4 场景) | ⚠️ | 见 #3 |
| AC5: resilience decision | TS4 (3 场景) | ✅ | e2e-test-plan |
| AC6: mapping_reason 4 种 | TS5 (4 场景) | ✅ 已修复 | e2e-test-plan |
| AC7: failover_trigger | TS6 (2 场景) | ✅ | e2e-test-plan |
| AC8: UI 4 场景 | TS7 (4 场景) | ✅ | e2e-test-plan |

> AC6 的 e2e 测试计划已覆盖 4 个枚举值。但 test_cases_template.json 缺少 `overflow_redirect` 用例，见 #5。

### 数据流串联路径验证

```
stream.ts (abortReason)
  → resilience.ts (error_code, headers_sent, resilience_action/reason)
    → failover-loop.ts (mapping_reason, failover_trigger)
      → proxy-logging.ts (logResilienceResult params)
        → log-helpers.ts (RequestLogParams + insertSuccessLog)
          → db/logs.ts (insertRequestLog SQL)
```

**关键验证**：此路径覆盖所有 8 个字段通过 `logResilienceResult()` 的写入。但纯成功路径（无 resilience）通过 `insertSuccessLog()` 写入时，`transport_kind` 的来源在 plan 中未指定。见 #6。

---

## 4. Execution Groups 合理性

### 分组合理性 ✅

| 维度 | BG1 (后端) | FG1 (前端) | 结论 |
|------|-----------|-----------|------|
| 类型划分 | 纯后端 | 纯前端 | ✅ |
| 文件数 | 9 个（2 create + 7 modify） | 1 个（1 modify） | ✅ |
| Task 数 | 4 | 1 | ✅ 功能关联度优先 |
| 功能关联度 | 同一数据流全链路 | 单一 v-if | ✅ |

### 文件数验证 ✅（改进）

当前 plan.md 第 52 行标注为 **"9 个文件（2 create + 7 modify）"**，与 File Structure 表一致。

| 操作 | 文件 | 核验 |
|------|------|------|
| create | `048_add_diagnostic_columns.sql` | ✅ |
| create | `diagnostic-fields.test.ts` | ✅ |
| modify | `types.ts`, `stream.ts`, `resilience.ts`, `failover-loop.ts`, `proxy-logging.ts`, `log-helpers.ts`, `logs.ts` | ✅ 7 个 |

**结论：上一轮 LOW #2 已修复。** 文件数标注准确。

### Wave 编排 ✅

| Wave | Groups | 并行性 | 结论 |
|------|--------|--------|------|
| Wave 1 | BG1, FG1 | 无文件冲突，完全独立 | ✅ |

### Subagent 配置完整性 ⚠️

- 注入上下文和读取文件列表充分 ✅
- 模型选择合理 ✅
- BG1 内部 Execution Flow 清晰地标注了 TDD（先写失败测试）→ 实现 → 审查 的三步循环 ✅

---

## 5. 后端设计充分性（L1 检查）

### 存储变更选型 ✅
8 列 NULLABLE，单一 migration，无数据迁移负担。

### 数据流分析 ✅
Plan 正确识别 `failover-loop.ts` 为数据汇总枢纽，并标注为风险点。

### 待观察的实现风险

**风险 1：成功路径 data source（新发现）**

Plan Task 3 Step 3 要求扩展 `insertSuccessLog()` 参数并传递所有 8 个字段。但 `insertSuccessLog()` 是纯成功路径，不经过 resilience 层，没有 `attempt.resultKind` 可用。Plan 未说明在此路径中：
- `transport_kind` 从何处获取（需从 handler 上下文判断 stream vs non-stream）
- 其余 7 个字段均应为 NULL

如果 executor 仅机械地扩展接口但不填充 `transport_kind`，则 AC1 的「非流式成功 → `success`」「流式成功 → `stream_success`」会在纯成功路径上失败。见 #6。

**风险 2：mapping_reason 在 failover 场景的赋值路径**

Plan 引用 `effectiveMappingReason`（来自 iterationSnapshot）作为 mapping_reason 的数据源。如果当前代码在 failover 路径上未将 `effectiveMappingReason` 更新为 `"failover_retry"`，则 AC6 的 failover_retry 场景会填错值。需在实现阶段验证。

---

## 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | ~~MUST FIX~~ ✅ | spec.md AC6, e2e TS5 | **AC6/TS5 已添加 failover_retry 覆盖。** v1 问题，v2 已修复。当前文档完整。 | ✅ **已修复（v2）。** |
| 2 | ~~LOW~~ ✅ | plan.md BG1 文件数 | **文件数标注已修正为 9。** 当前 plan.md 第 52 行正确标注。 | ✅ **已修复（v3）。** |
| 3 | **LOW** | spec.md AC4, plan.md Task 3, e2e TS3 | **headers_sent 的 0 与 NULL 语义仍无明确定义。** AC4 允许 `0 或 NULL` 给相同场景（"请求在 headers 发送前失败"），但未定义何时用 0、何时用 NULL。e2e TS3 隐含了规则（Node headersSent 映射），但 spec 层面未同步。 | 在 spec Constraints 或 AC4 中补充语义定义：`1` = headers 已发送，`0` = 确定未发送，`NULL` = 不适用（非流式成功请求等）。然后同步更新 e2e TS3 断言。 |
| 4 | **LOW** | plan.md Task 3 Step 4 | **failoverTrigger 提取方式与 spec FR7 不一致。** Spec 要求使用 `error.constructor.name`（通用，自动适配任意 Error 子类），Plan 使用 per-class `instanceof` 检查（需为每个 Error 类型手动添加分支）。两种方式当前提取值相同，但 Plan 方式在新增 Error 类型时需同步修改代码。 | 对齐 spec FR7：使用 `error.constructor.name ?? error.code ?? null` 替代 per-class instanceof。如果担心安全风险（如 Webpack 混淆等），在 plan 中明确说明过滤逻辑。 |
| 5 | **INFO** | test_cases_template.json | **缺少 overflow_redirect 专用测试用例。** e2e TS5 覆盖了 4 个 mapping_reason 枚举值，但 test_cases_template.json 仅含 TC-6-01 (direct_format)、TC-6-02 (group_base_rule)、TC-6-03 (failover_retry)，遗漏 overflow_redirect。 | 新增 TC-6-04: `mapping_reason=overflow_redirect`。实现步骤：配置短 context_window → 发送超窗口请求 → 触发 overflow → 断言 mapping_reason = "overflow_redirect"。 |
| 6 | **LOW** | plan.md Task 3 Step 3 | **Success 路径（insertSuccessLog）的 transport_kind 数据来源未指定。** Plan 要求扩展 `insertSuccessLog()` 传入 8 个新字段，但纯成功路径没有 `attempt.resultKind`。`transport_kind` 需要在 handler 层从请求的 `stream` 字段推导（"success" / "stream_success"），其余 7 个字段为 NULL。Plan 未说明此数据来源。 | 在 Task 3 Step 3 中补充成功路径的数据来源说明：`transport_kind` 从 handler 层面的 `req.body.stream` 判断（false → "success"，true → "stream_success"），其余 7 个字段在成功路径上均为 NULL。 |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，但不阻塞
> - **INFO**：观察记录，无需操作

---

### 等级判定校准

按方法论中的**等级判定校准规则**逐条复核：

| # | 校验规则 | 判定 | 说明 |
|---|---------|------|------|
| 3 | 是否导致"功能不可用或数据错误"？ | **LOW** ✅ | 实现层已有隐式规则（Node headersSent），不影响功能正确性 |
| 4 | 是否导致"功能不可用或数据错误"？ | **LOW** ✅ | 两种提取方式结果相同，仅维护性差异 |
| 5 | 是否导致"功能不可用或数据错误"？ | **INFO** ✅ | 缺少单个用例不影响端到端覆盖率（e2e TS5 已覆盖） |
| 6 | 是否导致"数据丢失"？ | **LOW** ✅ | 对经验丰富的 executor 不构成问题，但无经验的 executor 可能漏掉 |

**结论：0 条 MUST FIX（open）。所有问题均不影响功能正确性或数据完整性。**

---

## 结论

**通过。**

- 上一轮 MUST FIX #1：✅ 已验证保持修复状态
- 上一轮 LOW #2：✅ 已验证修复（文件数标注已修正）
- 当前 0 条 MUST FIX（open），3 条 LOW，1 条 INFO

3 条 LOW 问题（#3 headers_sent 语义、#4 failoverTrigger 方式、#6 success path 数据源）建议在编码阶段注意处理，但不阻塞进入编码阶段。

**已达评审轮次上限（3/3），如上述 LOW 问题在编码阶段修复，可直接进入下一阶段。**

### Summary

计划评审完成，第3轮通过，0条MUST FIX（open），3条LOW，1条INFO，建议进入编码阶段按 LOW 建议修复。

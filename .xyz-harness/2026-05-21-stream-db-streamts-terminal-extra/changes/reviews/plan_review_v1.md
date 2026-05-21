---
review:
  type: plan_review
  round: 1
  timestamp: "2026-05-21T20:00:00"
  target: ".xyz-harness/2026-05-21-stream-db-streamts-terminal-extra/spec.md + plan.md + e2e-test-plan.md"
  verdict: fail
  summary: "计划评审完成，第1轮，1条MUST FIX，2条LOW，需修改后重审"

statistics:
  total_issues: 3
  must_fix: 1
  must_fix_resolved: 0
  low: 2
  info: 0

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md:AC6, e2e-test-plan.md:TS5"
    title: "AC6/TS5 缺少 failover_retry 映射原因的测试覆盖"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 2
    severity: LOW
    location: "plan.md:BG1 Execution Groups — 文件数"
    title: "BG1 文件数标注不准确（10 vs 9）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 3
    severity: LOW
    location: "spec.md:AC4, plan.md:Task 3 Step 2, e2e-test-plan.md:TS3"
    title: "headers_sent 语义不明确（0 与 NULL 的区分标准未定义）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# 计划评审 v1

## 评审记录
- 评审时间：2026-05-21 20:00
- 评审类型：计划评审
- 评审对象：`spec.md` + `plan.md` + `e2e-test-plan.md`

---

## 1. Spec 完整性

### 目标明确性 ✅
目标清晰：将代理层运行时已区分但未持久化的 8 类诊断数据写入 `request_logs` 表，并修复前端模型超时 UI 缺陷。一段话能说清楚。

### 范围合理性 ✅
范围控制严格：8 个 DB 列均为 NULLABLE，无数据迁移负担。SSE 推送、Admin API 查询过滤、前端日志展示、历史数据回填全部标注为 Out of Scope。FR8（前端 UI 修复）范围表述清晰。

### 验收标准可量化 ✅
AC1-AC8 均包含具体的字段值断言（如 `transport_kind = "stream_success"`、`abort_reason = "idle_timeout"`），可直接写测试。

### 待决议项
无 `[待决议]` 标记。

---

## 2. Plan 可行性

### 任务拆分合理性 ✅
5 个 Task 粒度适中：Task 1（DB 层）→ Task 2（类型层）→ Task 3（数据流）→ Task 4（测试）→ Task 5（前端）。每个 Task 可由一个 subagent 独立完成。

### 依赖关系正确性 ✅
- Task 1 → Task 2 → Task 3 → Task 4：正确，被依赖的排在前面
- Task 5（前端）无依赖：正确，前后端完全独立
- BG1 和 FG1 无交叉依赖：正确

### 工作量估算 ✅
9 个后端文件 + 1 个前端文件的改动量，与项目规模匹配。migration 仅 8 条 ALTER TABLE，类型扩展均为可选字段，数据流为现有路径的参数传递。

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
| FR7: failover_trigger | Task 3 (wire) | ✅ |
| FR8: UI fix | Task 5 | ✅ |

未发现遗漏的 Task。

---

## 3. Spec 与 Plan 一致性

### 需求覆盖 ✅
Plan 覆盖了 spec 中所有需求项（FR1-FR8）。每个 FR 都能在 plan 的 File Structure 或 Task 中找到对应步骤。

### spec 未提及的额外工作 ✅
Plan 正确识别了 `insertSuccessLog` 路径也需要扩展（在 proxy-logging.ts 和 log-helpers.ts 中）。这是 spec 未明确提及的必要工作——spec 只写了 `logResilienceResult()` 作为写入点，但架构中有两条日志写入路径（一条走 resilience，一条走 success）。Plan 对此的补充是正确的。

### AC 覆盖测试计划 ✅

| AC | 测试场景 | 覆盖状态 | 位置 |
|----|---------|---------|------|
| AC1: transport_kind 6 种值 | TS1 (6 scenarios) | ✅ | e2e-test-plan.md |
| AC2: abort_reason 3 种值 + NULL | TS2 (4 scenarios) | ✅ | e2e-test-plan.md |
| AC3: error_code | TS3 (4 scenarios) | ✅ | e2e-test-plan.md |
| AC4: headers_sent | TS3 (4 scenarios) | ✅ | e2e-test-plan.md |
| AC5: resilience action/reason | TS4 (3 scenarios) | ✅ | e2e-test-plan.md |
| AC6: mapping_reason | TS5 (3 scenarios) | ⚠️ | e2e-test-plan.md (缺 failover_retry) |
| AC7: failover_trigger | TS6 (2 scenarios) | ✅ | e2e-test-plan.md |
| AC8: UI 修复 | TS7 (4 scenarios) | ✅ | e2e-test-plan.md |

> ⚠️ AC6 仅覆盖 3 个枚举值，FR6 中提到 4 个（含 `failover_retry`）。见 MUST FIX #1。

### 数据流串联路径验证

对照 CLAUDE.md 架构描述，验证数据流：

```
stream.ts (abortReason)
  → resilience.ts (error_code, headers_sent, resilience_action/reason)
    → failover-loop.ts (mapping_reason, failover_trigger, 汇总所有字段)
      → proxy-logging.ts (logResilienceResult 参数扩展)
        → log-helpers.ts (insertSuccessLog 扩展)  ← 需验证此路径数据来源
          → db/logs.ts (insertRequestLog SQL 扩展)
```

关键路径 `stream → resilience → failover-loop → logResilienceResult → insertRequestLog` 完整覆盖。

---

## 4. Execution Groups 合理性

### 分组合理性 ✅

| 维度 | BG1 (后端) | FG1 (前端) | 结论 |
|------|-----------|-----------|------|
| 类型划分 | 纯后端 | 纯前端 | ✅ |
| 文件数 | 9 个 | 1 个 | ✅ (≤ 10) |
| Task 数 | 4 | 1 | ✅ (功能关联度优先) |
| 功能关联度 | 全部耦合于同一数据流 | 单一 v-if 修改 | ✅ |

### BG1 文件数验证

实际文件数：**9 个**（2 create + 7 modify）

| 操作 | 文件 |
|------|------|
| create | `048_add_diagnostic_columns.sql`, `diagnostic-fields.test.ts` |
| modify | `types.ts`, `stream.ts`, `resilience.ts`, `failover-loop.ts`, `proxy-logging.ts`, `log-helpers.ts`, `logs.ts` |

Plan 标注「10 个文件（2 create + 8 modify）」与实际情况不符（9 个文件，7 个 modify）。见 LOW #2。

### Wave 编排合理 ✅

| Wave | Groups | 并行性 | 结论 |
|------|--------|--------|------|
| Wave 1 | BG1, FG1 | 无文件冲突，完全独立 | ✅ |

### Subagent 配置完整性 ⚠️

- "注入上下文"列出了 spec 全文 + CLAUDE.md + plan，足够
- "读取文件"列出了所有需读取的文件，足够
- **模型分配**：BG1 子配置说 `router-openai/glm-5.1`（executor）和 `router-openai/glm-5-turbo`（tdd-coder），但 Execution Flow 中各子步骤未指定使用哪个模型。可能导致 reviewer 和 executor 使用相同模型，降低 review 独立性。

### 上下文充分性 ✅

每组都注入了足够的上下文。spec 全文 + CLAUDE.md 架构约束 + plan Task 详情，能支撑 subagent 独立完成。

---

## 5. 后端设计充分性（L1 检查）

本 plan 标注为 L1（复杂度），适用 L1 检查清单。

### 存储变更选型 ✅
- 新增 8 个 `TEXT/INTEGER NULL` 列在现有 `request_logs` 表上
- 单一 migration 文件，可回退
- 所有列 NULLABLE，无需数据迁移
- 写入点集中在 `insertRequestLog()` 一个路径

### 异常处理与边界条件 ⚠️

| 边界条件 | Plan 覆盖情况 | 结论 |
|---------|-------------|------|
| `insertSuccessLog` 路径没有 resilience 数据 | 未明确说明 | ⚠️ |
| headers_sent 0 vs NULL 的区分 | 未定义明确标准 | ⚠️ |
| mapping_reason 枚举值未锁定 | 正确标注（实现阶段确认） | ✅ |
| 其中一条 abort 路径失败后其他字段完整性 | 未讨论 | INFO |

### 非功能性要求
未在 spec 中列出，无需 plan 覆盖。

---

## 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | **MUST FIX** | spec.md AC6, e2e-test-plan.md TS5 | **AC6 缺 failover_retry 映射原因**。FR6 列出了 4 个枚举值（`direct_format` / `group_base_rule` / `overflow_redirect` / `failover_retry`），但 AC6 仅包含前 3 个，缺少 `failover_retry`。对应的测试场景 TS5 也只覆盖 3 个。这导致 spec 内部 FR 与 AC 不一致。 | 在 AC6 中添加第 4 条：`- failover 重试 → DB 中 mapping_reason = "failover_retry"`；在 TS5 中添加对应的测试场景。如果实现阶段确认不锁定此枚举，应在本 spec 中明确标注 `failover_retry 待确认` 并列出风险。 |
| 2 | LOW | plan.md BG1 Execution Groups | **BG1 文件数标注不准确**。Plan 的 Execution Groups 文件数标注为「10 个文件（2 create + 8 modify）」，但 File Structure 表实际列出 9 个文件（2 create + 7 modify——`logs.ts` 被计入 modify 但未在表中独立列出？实际计数：create = migration + test file = 2, modify = types.ts + stream.ts + resilience.ts + failover-loop.ts + proxy-logging.ts + log-helpers.ts + logs.ts = 7, total = 9）。 | 修正文件数标注为「9 个文件（2 create + 7 modify）」。虽然不影响执行，但准确标注对 worktree 计划阶段有参考价值。 |
| 3 | LOW | spec.md AC4, plan.md Task 3, e2e-test-plan.md TS3 | **headers_sent 的 0 与 NULL 区分标准未定义**。AC4 允许 `headers_sent = 0` 或 `NULL` 给「请求在 headers 发送前失败」，但未说明何时用 0、何时用 NULL。TS3 同时断言了两种值（ETIMEDOUT → NULL，其他 pre-headers-failure → 0），但实现层面应有一致规则。如用 `0` 表示「确定未发送 headers」，`NULL` 表示「无法确定是否发送」（如非流式请求）。没有标准会导致不同开发者写出不一致的代码。 | 在 spec Constraints 或 Data Consumer Checklist 中定义 headers_sent 的语义：`NULL` = 不适用（非流式或非错误响应），`0` = 确定 headers 未发送，`1` = headers 已发送。然后同步更新 AC4 和 TS3 的断言值。 |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，但不阻塞
> - **INFO**：观察记录，无需操作

---

## 结论

**需修改后重审。**

1 条 MUST FIX（AC6/TS5 `failover_retry` 缺失）+ 2 条 LOW 问题。修复后进入第 2 轮。

### Summary

计划评审完成，第1轮，1条MUST FIX，需修改后重审。

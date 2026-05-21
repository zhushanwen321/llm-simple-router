---
verdict: pass
must_fix: 0
review:
  type: plan_review
  round: 2
  timestamp: "2026-05-21T21:00:00"
  target: ".xyz-harness/2026-05-21-stream-db-streamts-terminal-extra/spec.md + plan.md + e2e-test-plan.md + test_cases_template.json"
  verdict: pass
  summary: "计划评审完成，第2轮，0条MUST FIX（open），3条LOW，1条INFO，建议修复后进入下一轮"

statistics:
  total_issues: 5
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
    status: open
    raised_in_round: 1
    resolved_in_round: null
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
    location: "test_cases_template.json: TC-6-03 后"
    title: "test_cases_template.json 缺少 overflow_redirect 的专用测试用例"
    status: open
    raised_in_round: 2
    resolved_in_round: null
---

# 计划评审 v2

## 评审记录
- 评审时间：2026-05-21 21:00
- 评审类型：计划评审（第 2 轮）
- 评审对象：`spec.md` + `plan.md` + `e2e-test-plan.md` + `test_cases_template.json`

---

## 上一轮 MUST FIX 验证

### 重点验证：AC6 failover_retry 覆盖

**问题**：v1 轮 AC6 缺少 `failover_retry` 映射原因，与 FR6 的四枚举值不一致。

**当前状态检查：**

| 检查项 | v1 状态 | v2 状态 | 结论 |
|--------|---------|---------|------|
| spec.md AC6 | 仅 3 条（缺 failover_retry） | **4 条，包含 `failover 重试 → mapping_reason = "failover_retry"`** | ✅ 已修复 |
| e2e-test-plan.md TS5 | 3 场景（缺 failover_retry） | **4 场景，包含 `| failover 重试 | failover_retry |`** | ✅ 已修复 |
| test_cases_template.json | 无对应用例 | **TC-6-03: `mapping_reason=failover_retry`** | ✅ 已修复 |
| plan.md Task 3 | 未提及 failover_retry | Task 3 Step 4 提到从 `effectiveMappingReason` 提取 | ⚠️ 见下文 |

**结论：上一轮 MUST FIX #1 验证通过。** AC6 已完整覆盖 `failover_retry`，spec、e2e test plan、test cases 三者一致。✅

---

## 1. Spec 完整性

### 目标明确性 ✅
与 v1 一致。目标清晰。

### 范围合理性 ✅
Out of Scope 合理。八个新列均为 NULLABLE，无迁移负担。

### 验收标准可量化 ✅
AC1-AC8 均有具体值断言。

### 待决议项
无 `[待决议]` 标记。

---

## 2. Plan 可行性

### 任务拆分合理性 ✅
Task 1-5 粒度适中，无变化。

### 依赖关系 ✅
Task 1 → 2 → 3 → 4 正确。Task 5 独立。未发现依赖错误。

### 工作量估算 ✅
后端 9 文件 + 前端 1 文件，与项目规模匹配。

### 遗漏 Task 检查

| FR | 对应 Task | 状态 |
|----|----------|------|
| FR1: transport_kind | Task 1 (DB) + Task 2 (type) + Task 3 (wire) | ✅ |
| FR2: abort_reason | Task 2 (type) + Task 3 (wire) | ✅ |
| FR3: error_code | Task 2 (type) + Task 3 (wire) | ✅ |
| FR4: headers_sent | Task 2 (type) + Task 3 (wire) | ✅ |
| FR5: resilience decision | Task 2 (type) + Task 3 (wire) | ✅ |
| FR6: mapping_reason | Task 3 (wire) | ✅ |
| FR7: failover_trigger | Task 3 (wire) | ⚠️ 见 LOW #4 |
| FR8: UI fix | Task 5 | ✅ |

---

## 3. Spec 与 Plan 一致性

### 需求覆盖 ✅
Plan 覆盖 spec 所有 FR。逐条对照无遗漏。

### spec 未提及的额外工作 ✅
与 v1 一致。`insertSuccessLog` 路径扩展是正确的补全。

### AC 覆盖测试计划

| AC | 场景 | 覆盖状态 | 位置 |
|----|------|---------|------|
| AC1: transport_kind 6 种 | TS1 (6 场景) | ✅ | e2e-test-plan |
| AC2: abort_reason 4 种 | TS2 (4 场景) | ✅ | e2e-test-plan |
| AC3: error_code | TS3 | ✅ | e2e-test-plan |
| AC4: headers_sent | TS3 | ⚠️ | 见 LOW #3 |
| AC5: resilience decision | TS4 (3 场景) | ✅ | e2e-test-plan |
| AC6: mapping_reason 4 种 | TS5 (4 场景) | ✅ **已修复** | e2e-test-plan |
| AC7: failover_trigger | TS6 (2 场景) | ✅ | e2e-test-plan |
| AC8: UI 4 场景 | TS7 (4 场景) | ✅ | e2e-test-plan |

> ⚠️ AC6 的 test_cases_template.json 中 TC-6-01~03 仅覆盖 3 个枚举值，缺少 `overflow_redirect` 专用用例。详见 INFO #5。

---

## 4. Execution Groups 合理性

### 分组合理性 ✅
BG1（后端全链路 9 文件） + FG1（前端 1 文件），无混合类型组。

### Wave 编排 ✅
Wave 1 的 BG1 和 FG1 可并行。

### Subagent 配置完整性 ⚠️
- 注入上下文和读取文件充分 ✅
- 模型选择合理 ✅
- **文件数标注依然不准确**：File Structure 表列出 BG1 为 2 create + 7 modify = 9 文件，但 BG1 Subagent 配置的「修改/创建文件」标注仍为「10 个文件（2 create + 8 modify）」—— 见 LOW #2。

### 上下文充分性 ✅
各组注入 spec 全文 + CLAUDE.md + plan，可以支撑 subagent 独立完成。

---

## 5. 后端设计充分性（L1 检查）

### 存储变更 ✅
8 列 NULLABLE，单一 migration，无数据迁移风险。Plan 的 migration SQL 示例如同 spec 一致。

### 数据流路径 ✅
```
stream.ts (abortReason)
  → resilience.ts (error_code, headers_sent, resilience_action/reason)
    → failover-loop.ts (mapping_reason, failover_trigger, 汇总)
      → proxy-logging.ts (logResilienceResult 参数扩展)
        → log-helpers.ts (insertSuccessLog 扩展)
          → db/logs.ts (insertRequestLog SQL 扩展)
```

**关键验证点**：`failover-loop.ts` 是数据汇总枢纽，所有 8 个字段在此汇聚。Plan 正确识别此节点并标注为风险点。

### Plan Task 3 Step 4 详细审查

| 字段 | Plan 中提取方式 | 数据来源 | 完整性 |
|------|----------------|---------|--------|
| transport_kind | 从 attempt.resultKind | ResilienceLayer | ✅ |
| abort_reason | 从 result (stream_abort variant) | TransportResult | ✅ |
| error_code | 从 attempt.error_code | ResilienceAttempt | ✅ |
| headers_sent | 从 attempt.headers_sent | ResilienceAttempt | ✅ |
| resilience_action | 从 decide() 返回值 | ResilienceLayer | ✅ |
| resilience_reason | 从 decide() 返回值 | ResilienceLayer | ✅ |
| mapping_reason | 从 `effectiveMappingReason` (iterationSnapshot) | failover-loop | ⚠️ |
| failover_trigger | catch 块中 `instanceof` 判定 | failover-loop | ⚠️ |

**mapping_reason 风险**：Plan 引用 `effectiveMappingReason` 作为数据源，但未明确说明在 failover 场景中此值何时被设置为 `"failover_retry"`。spec FR6 写明数据源是 `mapping-resolver.ts` 的 `MappingResult.reason`，但 plan 引用的是 failover-loop 内部变量。如果现有代码未在 failover 路径中将 `effectiveMappingReason` 更新为 `"failover_retry"`，则提取的值不正确。

**failover_trigger 风险**：Spec FR7 要求使用 `error.constructor.name`（通用方法，自动适配所有 Error 子类），Plan 使用 per-class `instanceof` 检查（显式但需为每个 Error 类型添加判断）。两者行为不同：Plan 的 `instanceof` 方法会遗漏非显式检查的 Error 类型。见 LOW #4。

---

## 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | ~~MUST FIX~~ ✅ | spec.md AC6, e2e TS5 | **AC6/TS5 已添加 failover_retry 覆盖**。spec AC6 和 e2e TS5 已完整覆盖。 | ✅ **已修复**。 |
| 2 | LOW | plan.md BG1 Execution Groups | **BG1 文件数仍不准确**。File Structure 表实际为 2 create + 7 modify = 9 文件，但 BG1 Subagent 配置仍标注「10 个文件（2 create + 8 modify）」。 | 修正为「9 个文件（2 create + 7 modify）」：`migrations/048_*.sql` + `diagnostic-fields.test.ts` = 2 create；`types.ts` + `stream.ts` + `resilience.ts` + `failover-loop.ts` + `proxy-logging.ts` + `log-helpers.ts` + `logs.ts` = 7 modify。 |
| 3 | LOW | spec.md AC4, plan.md Task 3, e2e TS3 | **headers_sent 的 0 与 NULL 语义未定义**。AC4 允许 `0 或 NULL`，但无区分标准。Plan 用 Node 原生 `result.headersSent`（boolean），`false` → `0`，`undefined` ⇒ `NULL`。但 spec AC4 未同步此语义，可能导致实现与断言不一致。 | 在 spec Constraints 或 AC4 中补充定义：`0` = headers 确定未发送，`NULL` = 不适用（非流式成功请求或非错误场景）。同步更新 e2e TS3 断言值。 |
| 4 | LOW | plan.md Task 3 Step 4 | **failoverTrigger 提取方式与 spec FR7 不一致**。Spec FR7 要求使用 `error.constructor.name`（通用），Plan 使用 per-class `instanceof`（显式但不通用）。两者提取的值相同（如对 `ProviderSwitchNeeded`，`error.constructor.name` 和 `instanceof` 判定的类名一致），但 Plan 方法需为每个新增 Error 类型手动添加判断代码，而 spec 方法自动适配。 | 建议 plan 对齐 spec FR7，使用 `error.constructor.name ?? error.code ?? null`。如果需要排除某些 Error 类型（如不能对系统 Error 用 constructor.name），在 plan 中明确说明过滤逻辑。 |
| 5 | INFO | test_cases_template.json | **缺少 overflow_redirect 专用测试用例**。e2e 测试计划 TS5 覆盖了 4 个枚举值（含 overflow_redirect），但 test_cases_template.json 只有 TC-6-01 (direct_format)、TC-6-02 (group_base_rule)、TC-6-03 (failover_retry)，缺少 overflow_redirect 用例。 | 新增 TC-6-04: `mapping_reason=overflow_redirect`。实现层步骤：配置短 context_window 模型，发送超窗口请求 → 触发溢出重定向 → 断言 mapping_reason = "overflow_redirect"。 |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，但不阻塞
> - **INFO**：观察记录，无需操作

---

## 结论

**通过。**

上一轮 MUST FIX #1（AC6 failover_retry）已修复 ✅。本轮未发现 open MUST FIX。

当前 0 条 MUST FIX（open）。3 条 LOW + 1 条 INFO 建议在编码阶段修复，但不阻塞流程。

### Summary

计划评审完成，第2轮通过，0条MUST FIX（open），3条LOW，1条INFO。

---
review:
  type: spec_review
  round: 2
  timestamp: "2026-05-21T06:29:48"
  target: ".xyz-harness/2026-05-21-stream-db-streamts-terminal-extra/spec.md"
  verdict: pass
  summary: "Spec 评审完成，第2轮通过，0条 MUST FIX，上一轮 MUST FIX（数据消费者清单）已修复"

statistics:
  total_issues: 10
  must_fix: 0
  must_fix_resolved: 1
  low: 2
  info: 2

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md"
    title: "缺少数据消费者清单（违反 CLAUDE.md 强制性规则）"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2

  - id: 2
    severity: LOW
    location: "spec.md: AC1"
    title: "AC1 未覆盖全部 6 种 transport_kind 枚举值"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2

  - id: 3
    severity: LOW
    location: "spec.md: FR6"
    title: "mapping_reason 枚举值来源与完整性不明确"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2

  - id: 4
    severity: LOW
    location: "spec.md: FR7"
    title: "failover_trigger 提取机制未明确定义"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2

  - id: 5
    severity: INFO
    location: "spec.md"
    title: "Migration 编号信息过时"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2

  - id: 6
    severity: INFO
    location: "spec.md: FR1-FR8"
    title: "部分 FR 直接指定了实现位置，超出纯 spec 范围"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2

  - id: 7
    severity: LOW
    location: "spec.md: AC5"
    title: "AC5 未覆盖 resilience_action 的 'abort' 和 'done' 路径"
    status: open
    raised_in_round: 2
    resolved_in_round: null

  - id: 8
    severity: LOW
    location: "spec.md: AC6"
    title: "AC6 未覆盖 failover_retry 映射原因场景"
    status: open
    raised_in_round: 2
    resolved_in_round: null

  - id: 9
    severity: INFO
    location: "spec.md: Data Consumer Checklist, 验证方式"
    title: "buildUpdateQuery 用于 INSERT 的提法可能不准确（该工具是 UPDATE 用途）"
    status: open
    raised_in_round: 2
    resolved_in_round: null

  - id: 10
    severity: INFO
    location: "spec.md: Data Consumer Checklist, headers_sent 来源"
    title: "headers_sent 数据流起点未追溯至 transport 层实际来源"
    status: open
    raised_in_round: 2
    resolved_in_round: null

---

# Spec 评审 v2（第2轮）

## 评审记录
- 评审时间：2026-05-21 14:29
- 评审类型：Spec 评审
- 评审对象：`.xyz-harness/2026-05-21-stream-db-streamts-terminal-extra/spec.md`

---

## 上一轮 MUST FIX 修复验证

### Issue #1（MUST FIX）：数据消费者清单缺失 ✅ **已修复**

spec 新增了完整的 **Data Consumer Checklist** 章节，以表格形式列出全部 4 类消费者：

| 消费者 | 状态 | 结论 |
|--------|------|------|
| **DB 写入**（`insertRequestLog()`） | ✅ 完整覆盖 | 8 列逐一列出写入函数、数据来源 |
| **SSE 实时监控推送**（RequestTracker） | ✅ 明确标记 Out of Scope | `StreamMetricsSnapshot` 类型不变 |
| **Admin API 查询**（`/admin/api/logs`） | ✅ 明确标记 Out of Scope | 并说明 `SELECT *` 自动返回，无过滤参数 |
| **前端展示** | ✅ 明确标记 Out of Scope | 仅 FR8 涉及前端 ModelCard.vue |

每项均标注了验证状态。**满足 CLAUDE.md 强制性规则**。

---

## 上一轮 LOW/INFO 问题修复验证

| # | 问题 | 状态 | 修复方式 |
|---|------|------|---------|
| #2 (LOW) | AC1 未覆盖全部 6 种 transport_kind | ✅ **已修复** | 新增 `stream_error`、`error`、`throw` 三条路线，现共 6 条 AC 子条件 |
| #3 (LOW) | mapping_reason 枚举值来源不明确 | ✅ **已修复** | FR6 明确标明枚举来自 `mapping-resolver.ts: MappingResult.reason`，并注明 spec 阶段不锁定枚举值 |
| #4 (LOW) | failover_trigger 提取机制未定义 | ✅ **已修复** | FR7 明确区分：自定义 Error → `constructor.name`，系统 Error → `error.code`，无明确类型 → `null` |
| #5 (INFO) | Migration 编号过时 | ✅ **已修复** | spec 不再引用具体迁移数量，只说"单一 migration 文件" |
| #6 (INFO) | FR 混合实现细节 | ✅ **已关闭** | 这是项目的既有风格（FR 包含写入点），不视为问题，在 v2 中已使用 "写入点" 格式更规范地呈现 |

---

## 六元素完整性评估

### 1. Outcomes ✅
目标明确。Background 清晰描述了 P1/P2/P3 三类问题，FR1-FR7 逐一对应，FR8 独立处理 UI 缺陷。可以在一段话内完整描述 spec 范围。

### 2. Scope Boundaries ✅
"Out of Scope" 列出 6 项排除项：前端日志展示、SSE 实时推送、Admin API 过滤、request_metrics 修改、历史数据回填、死列清理。边界清晰合理。

### 3. Constraints ✅
6 条约束全部具体明确：
- 新列 nullable，默认 NULL（无数据迁移负担）
- 单一 migration 文件
- 写入集中在 `insertRequestLog()` 路径
- `ResilienceAttempt` 向后兼容
- FR8 不破坏已配置超时值
- 现有测试不受影响（nullable 列）

### 4. Decisions Made ✅
新增的 Data Consumer Checklist 是关键的决策记录。隐藏的决策（`headers_sent` 使用 INTEGER 0/1、枚举值使用 TEXT 存而非 CHECK 约束）已在 spec 中体现。

### 5. Task Breakdown ⚠️
Spec 不含独立的任务拆分，但 Complexity Assessment 给出了受影响的文件列表和风险分析。对于中等复杂度的 spec，此详细程度恰到好处。详细的任务拆分配给 plan.md。

### 6. Verification ✅
8 个 AC 覆盖了所有 FR 的核心验证场景。AC8 包含 4 个子条件完整覆盖了 UI 修复前后的行为。

---

## AC 可测试性分析

| AC | 可测试性 | 覆盖状态 | 备注 |
|----|---------|---------|------|
| AC1 | ✅ 完整覆盖 | 全部 6 种 transport_kind | 上一轮 3/6 问题已修复 |
| AC2 | ✅ | 4 种 abort 场景完全覆盖值域 + NULL | 完整 |
| AC3 | ✅ | ETIMEDOUT + 正常 NULL | 可精确 mock |
| AC4 | ✅ | 1 / 0-NULL / NULL 三种场景 | 清晰 |
| AC5 | ⚠️ 部分覆盖 | 缺 `abort` 和 `done` 两种 action | 见 Issue #7 |
| AC6 | ⚠️ 部分覆盖 | 缺 `failover_retry` 场景 | 见 Issue #8 |
| AC7 | ✅ | ProviderSwitchNeeded + 无触发 NULL | 完整 |
| AC8 | ✅ | 4 个子条件完整覆盖 UI | 包含保存重启验证 |

---

## 与 CLAUDE.md 架构约束一致性

| 约束 | 状态 | 说明 |
|------|------|------|
| **数据消费者清单**（新增字段 MUST） | ✅ | Data Consumer Checklist 章节满足要求 |
| **禁止裸 JSON.parse** | ✅ 不相关 | 新增列均为独立 TEXT/INTEGER 列，非 JSON 字段 |
| **SSE 流式代理架构** | ✅ | FR2 的 3 条 abort 路径与 StreamProxy 状态机一致 |
| **重试链数据流** | ✅ | FR5 写入点与 `logResilienceResult()` → `insertRequestLog()` 路径一致 |
| **token 计数规则** | ✅ 不相关 | 本次不涉及 token 计数 |
| **迁移管理** | ✅ | 单一 migration 文件，符合项目惯例 |
| **前端禁止原生 HTML** | ✅ | FR8 仅修改 `v-if` 条件，不引入原生元素 |
| **`buildUpdateQuery` 白名单** | ⚠️ INFO | 见 Issue #9 |

---

## 本轮发现的问题

### Issue #7（LOW）— AC5 未覆盖 resilience_action 的 "abort" 和 "done" 路径

**位置**: `spec.md: AC5`

**描述**:
FR5 定义了 `resilience_action` 的四种可能值：`retry` / `failover` / `abort` / `done`。但 AC5 仅覆盖了 `retry`、`failover` 和 `IS NULL`（成功路径）三种场景，缺少 `abort` 和 `done` 的验收标准：

| AC5 现有条件 | 缺失 |
|-------------|------|
| `retry` ✅ | `abort` ❌ — resilience 决定放弃时的场景 |
| `failover` ✅ | `done` ❌ — resilience 已完成（无需进一步操作）的场景 |
| `IS NULL` ✅ | — |

**验证**: `abort` 路径在 `decide()` 中确实可能返回（当符合 abort 条件时），`done` 是 `failover-loop.ts` 中重试循环自然结束的场景。缺少对应的测试验收标准。

**建议**: 补充两种场景的验收标准，例如：
- "resilience 决定放弃重试 → DB 中 `resilience_action = "abort"`，`resilience_reason` 非空"
- "单次请求成功（非重试/非 failover）→ DB 中 `resilience_action IS NULL`（已在 AC5 中，保留）"
- 如 `done` 只在代码内部使用不暴露到 DB，需在 spec 中说明。

---

### Issue #8（LOW）— AC6 未覆盖 failover_retry 映射原因场景

**位置**: `spec.md: AC6`

**描述**:
FR6 列出了 `mapping_reason` 的已知枚举值：`direct_format` / `group_base_rule` / `overflow_redirect` / `failover_retry`。但 AC6 仅覆盖了前三个，缺少 `failover_retry`：

```
AC6 现有:
- direct_format ✅
- group_base_rule ✅
- overflow_redirect ✅
- failover_retry ❌  <- 未覆盖
```

**验证**: `failover_retry` 是 failover 场景下重新解析映射时产生的 reason 值。需要确认该值是否确实会被写入 DB（FR6 列为已知值），如果是则 AC6 应覆盖。

**建议**: 补充 `failover_retry` 的验收标准，或在 FR6 中明确说明 `failover_retry` 不在本次范围内/不在 DB 中出现。FR6 的措辞"spec 阶段不锁定枚举"部分缓解了此问题，但 AC 覆盖不足仍会导致测试遗漏。

---

### Issue #9（INFO）— Data Consumer Checklist 中 "buildUpdateQuery 用于 INSERT" 可能不准确

**位置**: `spec.md: Data Consumer Checklist, 验证方式`

**描述**:
spec 在 Data Consumer Checklist 的验证方式中写道："`RequestLogInsert` 类型扩展 8 个可选字段，`insertRequestLog()` SQL 已覆盖（使用 `buildUpdateQuery` 白名单模式）。"

根据 CLAUDE.md 和基础设施扫描：
- `buildUpdateQuery()` 定义在 `db/helpers.ts`，职责为 **UPDATE 操作**的白名单过滤
- `insertRequestLog()` 是一个直接 INSERT 函数，很可能使用手写的 INSERT SQL 而非 `buildUpdateQuery`
- `buildUpdateQuery` 用于 `updateLogStreamContent()`、`updateLogClientStatus()` 等 UPDATE 场景

**影响**: 此描述不影响 spec 的 FR 定义或 AC 验证。它是实现层面的假设，可能不准确。

**建议**: 将验证方式中的 "使用 `buildUpdateQuery` 白名单模式" 修改为更中性的描述，如 "`RequestLogInsert` 类型扩展 8 个可选字段，`insertRequestLog()` 的 INSERT SQL 通过白名单方式确保新列被写入（无需新增 SQL 语句）"，避免引用具体的工具函数。

---

### Issue #10（INFO）— headers_sent 数据流起点未追溯至 transport 层来源

**位置**: `spec.md: Data Consumer Checklist, headers_sent 来源列"

**描述**:
Data Consumer Checklist 中 `headers_sent` 的"来源"标注为 `ResilienceAttempt.headers_sent`。但这只是中继类型，**原始数据起点**在 transport 层（`StreamProxy` 在发送 headers 后才知道 headers 状态）。

FR4 的写入点说 "`resilience.ts` 中 `ResilienceAttempt` 类型新增 `headers_sent` 字段，`decide()` 时填充"。但 `decide()` 如何知道 headers 是否已发送？实际数据流可能是：

```
StreamProxy（知道 headers 已发/未发）
  → TransportResult / error 携带 headers_sent 标志
    → resilience.ts 的 failover-loop 在 catch 处获取
      → ResilienceAttempt.headers_sent
        → logResilienceResult() → insertRequestLog()
```

**影响**: 这不是 spec 的缺陷（spec 定义 WHAT，plan/实现决定 HOW）。但 Data Consumer Checklist 中标注不完整的数据来源可能误导实现者以为 `ResilienceAttempt` 需要自己产生 `headers_sent`。

**建议**: 在 Data Consumer Checklist 的"来源"列补全完整的溯源链，例如标注为 "Transport layer → TransportResult/error → ResilienceAttempt.headers_sent" 或类似表述，提示实现者需要在 transport 层采集此信息并向上传递。或保持现状，由 plan 阶段处理数据流设计。

---

## 总结

| 维度 | 结论 |
|------|------|
| 六元素完整性 | ✅ 通过（5/6 完整，Task Breakdown 由 plan 补充） |
| AC 可测试性 | ✅ 基础覆盖完整，2 条 LOW 建议补充 |
| 架构约束一致性 | ✅ 全部满足 |
| 数据消费者清单 | ✅ 已按 CLAUDE.md 要求添加 |
| 上一轮 MUST FIX | ✅ 已全部修复 |

**结论: 通过**。0 条 MUST FIX，2 条 LOW 建议，2 条 INFO 记录。建议 plan 阶段处理 Issue #10 的数据流设计，测试阶段确保 Issue #7 和 #8 的 AC 覆盖。

---

## Summary

Spec 评审完成，第2轮通过，0条 MUST FIX，上一轮 MUST FIX（数据消费者清单）已修复，新发现 2 条 LOW 和 2 条 INFO。

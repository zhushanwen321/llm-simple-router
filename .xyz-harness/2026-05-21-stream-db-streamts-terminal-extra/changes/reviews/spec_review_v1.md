---
review:
  type: spec_review
  round: 1
  timestamp: "2026-05-21T14:30:00"
  target: ".xyz-harness/2026-05-21-stream-db-streamts-terminal-extra/spec.md"
  verdict: fail
  summary: "Spec 评审完成，第1轮，1条MUST FIX，需补充数据消费者清单后重审"

statistics:
  total_issues: 6
  must_fix: 1
  must_fix_resolved: 0
  low: 3
  info: 2

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md: Constraints 章节"
    title: "缺少数据消费者清单（违反 CLAUDE.md 强制性规则）"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 2
    severity: LOW
    location: "spec.md: AC1"
    title: "AC1 未覆盖全部 6 种 transport_kind 枚举值"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 3
    severity: LOW
    location: "spec.md: FR6"
    title: "mapping_reason 枚举值来源与完整性不明确"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 4
    severity: LOW
    location: "spec.md: FR7"
    title: "failover_trigger 提取机制未明确定义"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 5
    severity: INFO
    location: "spec.md: Constraints 章节"
    title: "Migration 编号与实际不符（CLAUDE.md 记录 19 个，实际 47 个）"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 6
    severity: INFO
    location: "spec.md: FR1-FR8"
    title: "部分 FR 直接指定了实现位置，超出纯 spec 范围"
    status: open
    raised_in_round: 1
    resolved_in_round: null

---

# Spec 评审 v1

## 评审记录
- 评审时间：2026-05-21 14:30
- 评审类型：Spec 评审
- 评审对象：`.xyz-harness/2026-05-21-stream-db-streamts-terminal-extra/spec.md`

---

## 1. 六元素完整性评估

### 1.1 Outcomes ✅ — 目标明确
Background 清晰描述了三类数据缺失问题（P1 基础分类维度缺失、P2 重试/故障诊断信息丢失、P3 有数据但不可查询），FR1-FR7 逐一对应，FR8 独立处理 UI 缺陷。目标可在一段话内说清楚。

### 1.2 Scope Boundaries ✅ — 范围合理
"Out of Scope" 明确列出了 6 项排除项：前端日志展示、SSE 实时推送、Admin API 过滤、request_metrics 修改、历史数据回填、死列清理。范围控制良好，8 个 FR 聚焦在 DB 持久化和 UI 修复。

### 1.3 Constraints ✅ — 约束清晰
- 所有新列 nullable，默认 NULL ✅
- 单一 migration 文件 ✅
- 写入集中到 `insertRequestLog()` 路径 ✅
- `ResilienceAttempt` 向后兼容 ✅
- ModelCard.vue 不影响已配置值 ✅
- 现有测试不受影响 ✅

### 1.4 Decisions Made ⚠️ — 部分明确
已隐含的决策：
- `headers_sent` 使用 INTEGER 0/1（SQLite 无 Boolean 类型，合理）
- 枚举值以 TEXT 存储（未使用 CHECK 约束，AC 定义有效值集合）

**遗漏的决策：** 见 MUST FIX #1。

### 1.5 Task Breakdown ⚠️ — 见 Complexity Assessment
Spec 不含独立的 Task Breakdown 章节，但 Complexity Assessment 提供了高层次的修改文件列表和风险点分析，在 spec 层面已足够，详细的 task 拆分应由 plan.md 完成。

### 1.6 Verification ✅ — AC 可测试
8 个 AC 设计良好，每个都有明确的输入→期望输出映射，可编写自动化测试验证。AC8 包含 4 个子条件覆盖所有 UI 场景。

---

## 2. AC 可测试性分析

| AC | 可测试性 | 分析 |
|----|---------|------|
| AC1 | ⚠️ 部分覆盖 | 见 Issue #2 |
| AC2 | ✅ | 4 个子条件完全覆盖 abort_reason 的值域 |
| AC3 | ✅ | clear mapping: ETIMEDOUT → value, success → NULL |
| AC4 | ✅ | 3 种场景覆盖 headers_sent 的 0/1/NULL |
| AC5 | ✅ | 3 种动作覆盖 resilience_action 的值域 |
| AC6 | ✅ | 3 种映射场景覆盖 mapping_reason 的值域 |
| AC7 | ✅ | ProviderSwitchNeeded 触发场景 + 正常无触发场景 |
| AC8 | ✅ | 4 个子条件完整覆盖 UI 行为，包含保存后验证 |

---

## 3. 与 CLAUDE.md 项目架构约束的一致性

### 3.1 数据消费者清单规则违反 ⚠️ (MUST FIX)
CLAUDE.md 强制规定：

> **新字段数据消费者检查**
> 新增 DB 列或 metadata 字段时，必须在 spec 阶段列出所有数据消费者并逐一验证：
> - DB 写入（`insertMetrics()`、`insertRequestLog()` 等）
> - SSE 实时监控推送（`RequestTracker` 的 streamMetrics 等）
> - Admin API 查询（`getMetricsSummary()` 等）
> - 前端展示（组件取数据路径）
> **任何消费者遗漏即视为 MUST FIX。**

当前 spec 仅在 Out of Scope 中模糊提到 SSE 推送和前端展示被排除，但：
1. **未列出完整的 4 类消费者清单**并以表格/清单形式逐一验证
2. **Admin API 查询完全未被提及** — 现有 `GET /admin/api/logs` 端点会自动返回新增的 nullable 列，虽然不会出错，但这是一个未经评估的消费者
3. 各 FR 中的"写入点"描述了 DB 写入路径，但分散在各处，缺少统一的消费者验证清单

### 3.2 数据表一致性 ✅
新列全部在 `request_logs` 表，与 CLAUDE.md 描述的该表用途"请求日志（含完整链路：client_request/upstream_request/upstream_response/client_response）"一致。

### 3.3 Migration 策略 ✅
单一 migration 文件存放所有 8 列变更，postbuild 会复制 migrations 目录到 dist，符合项目规范。

### 3.4 SSE 流式代理架构 ✅
`StreamProxy` 状态机+ `SSEMetricsTransform` 旁路采集的设计与 abort_reason 写入需求兼容，spec 正确指定了三条 abort 路径。

### 3.5 其他架构一致性
- ❌ `headers_sent` 在 resilience 决策点确定：需要确认 resilience 层在决定 retry/abort 时是否知晓 headers 发送状态。如果 headers 发送状态只能在 transport 层确定，则需要从 transport 层向上传递。spec 未讨论此数据流的时序/方向。
- ⚠️ `request_logs` 表已有 47 个 migration 文件（而非 CLAUDE.md 记录的 19 个），spec 的 Constraints 引用了旧的迁移数量，属于 INFO 级不一致。

---

## 4. 遗漏的需求或隐含假设

### 4.1 Admin API 消费者的隐含影响
新增列自动出现在 `GET /admin/api/logs` 的响应中（`SELECT *`），但 spec 未评估此影响：
- 是否需要对 response 做列白名单？无需，nullable 列不影响现有前端渲染
- 日志详情文件（`logs/<logId>.json`）是否需要包含新列？如果 `insertRequestLog()` 同时写入文件，需要确认

### 4.2 headers_sent 数据流方向
AC4 定义了 headers_sent 的语义，但未明确数据如何从 transport 层（StreamProxy）传递到 resilience 决策层（`decide()`）。如果 transport 层发生错误时才知道 headers 是否已发送，则需要通过 `TransportResult` 传递，而非直接从 `ResilienceAttempt` 产生。spec 的 FR4 说"`decide()` 时填充"，但这意味着 resilience 层需要从上游获取此信息。

### 4.3 mapping_reason 枚举值的代码一致性
FR6 列出了 4 个枚举值，但 `mapping-resolver.ts` 是否完全返回这些字符串？如果代码中有额外的 reason 值未被 spec 覆盖（如 `session_recovery`、`image_fallback`、`no_match`），会导致数据不一致。

### 4.4 failover_trigger 提取机制
FR7 说"catch 这些错误时提取类型名"，但未明确使用什么机制。不同错误来源可能需要不同的提取方式：
- `ProviderSwitchNeeded` — 自定义 Error 类，可用 `constructor.name`
- 系统 Error（ETIMEDOUT） — `error.code` 而非 `constructor.name`
- Semaphore 错误 — 需要确认是否也是自定义 Error 类

---

## 5. 模糊语言检查

| 位置 | 原文 | 问题 |
|------|------|------|
| FR7 | "提取类型名" | 提取方式未定义（`constructor.name`? `error.code`? 自定义字段?） |
| FR6 | "枚举值包括" | 用"包括"而非"限定为以下值"，暗示可能不完整 |
| FR8 | "修复 `v-if` 条件" | 未说明替换为什么条件，仅通过 AC 定义预期行为 |
| Complexity | "约 5 个文件" | 实际会影响更多文件（+ migration, + db/logs.ts, + log-helpers.ts），但可作为估算接受 |

---

## 发现的问题

| # | 优先级 | 位置 | 描述 | 修改建议 |
|---|--------|------|------|---------|
| 1 | **MUST FIX** | spec.md: Constraints 章节 | **数据消费者清单缺失**。CLAUDE.md 强制要求新增 DB 列时必须列出所有消费者并逐一验证（DB写入/SSE推送/Admin API查询/前端展示）。spec 缺少此清单。Admin API 消费者完全未被提及。 | 新增 "Data Consumer Verification" 章节，以表格形式列出 4 类消费者，每项标注是否受影响及验证状态，即使某些消费者为 Out of Scope 也需明确标注。 |
| 2 | LOW | spec.md: AC1 | **AC1 未覆盖全部 6 种 transport_kind**。FR1 定义了 `success` / `stream_success` / `stream_error` / `stream_abort` / `error` / `throw`，但 AC1 仅覆盖 `stream_success`、`success`、`stream_abort` 3 种。`stream_error`、`error`、`throw` 缺少验收标准。 | 在 AC1 补充 `stream_error`（流式请求过程中出错）、`error`（非流式请求出错）、`throw`（异常抛出）三种路径的验收标准，或说明为何不可测试/不在范围内。 |
| 3 | LOW | spec.md: FR6 | **mapping_reason 枚举值来源与完整性不明确**。spec 列出 4 个值但未说明与 `mapping-resolver.ts` 实际返回值的对应关系。代码中可能存在其他 reason 值被遗漏。 | 对照 `mapping-resolver.ts` 的实际返回值，确认枚举值完整覆盖，或在 spec 中注明"当前框架下产生的值包括但不限于以下"，并列出完整的预定义值集合。 |
| 4 | LOW | spec.md: FR7 | **failover_trigger 提取机制未明确定义**。"提取类型名"对不同类型的 Error 提取方式不同：自定义 Error 类用 `constructor.name`，系统 Error（ETIMEDOUT）用 `error.code`。 | 明确 failover_trigger 的提取规则：使用 `error.constructor.name` 还是其他机制，列出每种已知错误类型对应的 trigger 值。 |
| 5 | INFO | spec.md: Constraints 章节 | **Migration 编号信息过时**。CLAUDE.md 记录"19 个迁移"，spec 引用此说法，但实际有 47 个迁移文件（`router/src/db/migrations/` 下编号到 047）。 | 更新为实际迁移数量（47），并指定新 migration 文件编号（如 `048_`）。 |
| 6 | INFO | spec.md: FR1-FR8 | **部分 FR 直接指定了实现位置**。如 "`resilience.ts` 中 `ResilienceAttempt` 类型新增"、"`failover-loop.ts` catch 这些错误"。这些对 reviewer 有参考价值，但混合了纯 spec 和实现细节。 | 建议保持现状（不影响 spec 质量），或标记为 Implementation Guidance 注释。 |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，但不阻塞
> - **INFO**：观察记录，无需操作

---

## 结论

**需修改后重审。** 1 条 MUST FIX（数据消费者清单缺失，违反 CLAUDE.md 强制性规则），3 条 LOW 建议。

核心问题是 CLAUDE.md 明确规定"新增 DB 列或 metadata 字段时，必须在 spec 阶段列出所有数据消费者并逐一验证"，当前 spec 未满足此要求。建议在 Constraints 章节或新增独立章节中，以表格形式列出 DB写入 / SSE推送 / Admin API / 前端展示 四类消费者，逐项标注"受影响/不受影响"及验证结论。

---

## Summary

Spec 评审完成，第1轮，1条MUST FIX，需补充数据消费者清单后重审。

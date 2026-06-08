---
review:
  type: plan_review
  round: 1
  timestamp: "2026-06-08T16:30:00"
  target: ".xyz-harness/2026-06-08-metrics-aggregation/plan.md"
  verdict: fail
  summary: "计划评审第1轮，发现5条 MUST FIX：双写异常吞没、聚合表主键设计风险、metrics-10min.ts 职责归属矛盾、聚合段 success_rate 近似未告知前端、查询路由函数读取 settings 缓存策略不一致。"

statistics:
  total_issues: 10
  must_fix: 5
  must_fix_resolved: 0
  low: 3
  info: 2

issues:
  - id: 1
    severity: MUST_FIX
    location: "plan-backend.md → BG2 → insertMetrics 双写改造点"
    title: "双写失败静默 catch 导致聚合数据静默丢失"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 2
    severity: MUST_FIX
    location: "plan-backend.md → BG1 → 迁移 SQL 骨架 + plan.md → File Structure"
    title: "metrics-10min.ts 职责归属矛盾：plan.md 归 BG1(plan-backend)，File Structure 归 BG1(plan.md) 也列为 metrics-10min.ts"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 3
    severity: MUST_FIX
    location: "plan-backend.md → BG3 → getStats 聚合段"
    title: "聚合段 success_rate 硬编码 100% 但前端无感知，误导用户"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 4
    severity: MUST_FIX
    location: "plan-api-contract.md → metrics_detail_days 配置生命周期"
    title: "查询路由函数读取 settings 的缓存策略未定义，可能导致路由决策过期"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 5
    severity: MUST_FIX
    location: "plan-backend.md → BG1 → UPSERT 语句"
    title: "聚合表主键含 6 列且用 WITHOUT ROWID，高基数组合导致空间膨胀和写入退化"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 6
    severity: LOW
    location: "plan.md → Execution Groups → BG1"
    title: "BG1 同时负责 DB 迁移 + CRUD + Settings API + admin settings 端点，职责偏重"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 7
    severity: LOW
    location: "plan-frontend.md → FG1.4 → useDashboard.ts"
    title: "移除 aggregateAllProviderInputTokens 后 provider token labels 数据来源不明确"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 8
    severity: LOW
    location: "plan.md → Spec Coverage Matrix"
    title: "FR-5 筛选维度在 Task 列表中无显式 Task 覆盖"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 9
    severity: INFO
    location: "plan-backend.md → BG4 → 活动图端点"
    title: "活动图端点缺少分页或 limit 参数，30 天 × 144 桶/天 = 4320 条全量返回"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 10
    severity: INFO
    location: "e2e-test-plan.md → TS-4"
    title: "查询路由 E2E 测试依赖实际时间流逝，缺乏可重复的时间边界控制方案"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# 计划评审 v1

## 评审记录

- **评审时间**：2026-06-08 16:30
- **评审类型**：计划评审（L1）
- **评审对象**：`spec.md` + `plan.md` + `plan-backend.md` + `plan-api-contract.md` + `plan-frontend.md` + `e2e-test-plan.md` + `use-cases.md` + `non-functional-design.md`
- **复杂度**：L2（后端查询路由 + 跨表 UNION + 前端时间选择器完全重写）

---

## 1. spec 完整性

### 目标明确性 ✅

spec 目标清晰：将 `request_metrics` 拆分为明细表 + 聚合表，Dashboard 查询按时间范围路由，重构时间选择器。一段话能说清楚。

### 范围合理性 ✅

范围有明确边界：
- 聚合粒度固定 10 分钟（不可配置）
- `metrics_10min` 永久保留
- 不做历史数据回填
- `usage_windows` 表保留但不删除

### 验收标准可量化 ✅

AC-1 到 AC-6 均可写测试验证：
- AC-1：验证 UPSERT 后桶行字段值
- AC-2：验证 Settings 页面和 API 校验
- AC-3：UI 交互（E2E 测试）
- AC-4：查询响应时间 < 100ms
- AC-5：清理逻辑验证
- AC-6：向后兼容验证

### `[待决议]` 项

无显式 `[待决议]` 标记。

---

## 2. plan 可行性

### 任务拆分合理性

7 个 Task 拆分为 4 个后端 Group + 3 个前端 Group，粒度适中。每个 Task 可由一个 subagent 独立完成。

### 依赖关系正确性 ✅

依赖图清晰：BG1 → BG2/BG3 → BG4 → FG1/FG3 → FG2。被依赖的基础设施（聚合表）排在最前面。

### 工作量估算

| Group | 涉及文件数 | 难度 | 评估 |
|-------|-----------|------|------|
| BG1 | 5 | 中 | 合理 |
| BG2 | 4 | 中 | 合理 |
| BG3 | 4 | 高 | **偏乐观**（6 个查询函数改造 + UNION 合并逻辑） |
| BG4 | 2 | 低 | 合理 |
| FG1 | 4 | 高 | **偏乐观**（新组件 + composable + Dashboard.vue 重构） |
| FG2 | 5 | 中 | 合理 |
| FG3 | 3 | 低 | 合理 |

### 遗漏检查

对照 spec 逐条：
- FR-1 ✅（BG1 + BG2）
- FR-2 ✅（BG1 + BG4 + FG3）
- FR-3 ✅（FG1）
- FR-4 ✅（BG3）
- FR-5 ⚠️（FR-5 筛选维度无显式 Task，见 Issue #8）
- 清理 ✅（BG2）
- 向后兼容 ✅（贯穿所有 Group）

---

## 3. spec 与 plan 一致性

### FR 逐条覆盖

| FR | plan Task | 状态 |
|----|-----------|------|
| FR-1 聚合表创建与写入 | Task 1 + 2 | ✅ |
| FR-2 Metrics 保留配置 | Task 1 + 4 + 7 | ✅ |
| FR-3 时间选择器重构 | Task 4 + 5 | ✅ |
| FR-4 查询路由 | Task 3 | ✅ |
| FR-5 筛选维度 | 无显式 Task | ⚠️ Issue #8 |
| AC-1 到 AC-6 | Spec Coverage Matrix | ✅ 覆盖 |

### plan 中 spec 未提及的额外工作

- `getMetricsActivity()` API 端点（BG4）— spec FR-3 提到活动图但未显式要求新 API。plan 合理推断需要，不视为过度实现。
- `deleteMetricsBefore()` 辅助函数 — spec AC-5 提到清理，plan 拆分合理。

### 验收标准与 Task 对应

Spec Coverage Matrix 中 AC-1 到 AC-6 均有对应 Task 映射。无遗漏。

---

## 4. Execution Groups 合理性

### 分组合理性

- 每组文件数 ≤ 5 ✅
- 每组 Task 数 ≤ 1 ✅（但 BG1 职责偏重，见 Issue #6）

### 类型划分

前端和后端严格分离 ✅。无混合类型 Group。

### 功能关联度

- BG1（聚合表 + Settings）— 两者都是基础设施，关联紧密 ✅
- BG2（双写 + 清理）— 都围绕 insertMetrics 的扩展，关联紧密 ✅
- BG3（查询路由）— 6 个函数的同类改造，关联紧密 ✅
- BG4（API 端点）— 两个新增端点，关联合理 ✅
- FG1-FG3 前端分组合理 ✅

### 依赖关系

Wave 编排正确：
- Wave 1: BG1（无依赖）✅
- Wave 2: BG2 + BG3（并行，都依赖 BG1）✅
- Wave 3: BG4（依赖 BG1 + BG3）✅
- Wave 4: FG1 + FG3（并行，都依赖 BG4）✅
- Wave 5: FG2（依赖 FG1）✅

### Subagent 配置完整性

每个 Group 都包含 Agent、Model、注入上下文、读取文件、修改/创建文件 ✅。上下文注入充分，不含糊引用。

---

## 5. 后端设计充分性

### "为什么"说明

- 双写 UPSERT 选择理由（SQLite WAL 原子性）✅
- WITHOUT ROWID 选择理由（主键覆盖所有查询）✅
- 聚合段 success_rate 近似处理 — 见 Issue #3

### 存储变更选型理由

`metrics_10min` 表设计理由充分：10 分钟粒度、6 维度组合主键、聚合指标列表明确。

### 遗漏的边界条件

1. **双写异常处理**：non-functional-design 提到"catch 后静默跳过"，但 plan-backend.md 的双写改造点未提及 catch 策略。静默吞异常会导致聚合数据静默丢失，前端展示的活动图和统计数据会与实际不符（Issue #1）。
2. **聚合表写入失败后的数据补偿**：静默跳过后，聚合表缺数据如何修复？无回填机制。
3. **跨越分界线 UNION 的 null 值处理**：聚合表某些字段（如 p50/p95 ttft）返回 NULL，外层合并时需要处理。

### 非功能性要求

non-functional-design.md 覆盖了稳定性、数据一致性、性能、安全 ✅。但 Issue #1 的静默 catch 与"数据一致性"章节矛盾。

---

## 6. AC 覆盖矩阵

| AC | 覆盖状态 | 对应 Task | E2E 测试 |
|----|---------|----------|---------|
| AC-1 聚合表写入 | ✅ | Task 1 + 2 | TS-1 |
| AC-2 Metrics 保留配置 | ✅ | Task 1 + 4 + 7 | TS-2 |
| AC-3 时间选择器 | ✅ | Task 4 + 5 | TS-3 |
| AC-4 查询路由 | ✅ | Task 3 | TS-4 |
| AC-5 清理逻辑 | ✅ | Task 2 | TS-5 |
| AC-6 向后兼容 | ✅ | 全部 | TS-6 |

---

## 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | MUST FIX | plan-backend.md → BG2 → insertMetrics 双写改造点 | **双写失败静默 catch 导致聚合数据静默丢失。** non-functional-design 明确说"catch 后静默跳过"，但 plan-backend 的双写改造点未描述 catch 策略。静默吞异常意味着：聚合表长期缺数据，Dashboard 统计偏差，用户不可感知。违反 CLAUDE.md「数据丢失必须标 MUST FIX」原则。 | 双写 catch 应记录错误日志（`console.error('upsertMetrics10min:', e)`）而非静默跳过。进一步可考虑定期一致性校验（对比聚合表 SUM 与明细表 COUNT），或在 plan 中显式声明"聚合表数据为近似值"并告知前端。 |
| 2 | MUST FIX | plan.md File Structure vs plan-backend.md BG1 | **metrics-10min.ts 职责归属矛盾。** plan.md File Structure 将 `metrics-10min.ts` 归为 BG1 create，但 plan-backend.md BG1 的文件列表里没有 `metrics-10min.ts`（只有 migrations、metrics.ts、index.ts）。BG2 的读取文件列表引用了 `metrics-10min.ts`（BG1 产出），但 BG1 是否创建该文件不明确。subagent 执行时会困惑。 | 统一 plan.md 和 plan-backend.md 的文件归属。建议将 `metrics-10min.ts` 明确列在 BG1 的创建文件列表中（plan-backend.md 也需补充）。 |
| 3 | MUST FIX | plan-backend.md → BG3 → getStats 聚合段 | **聚合段 success_rate 硬编码 100%（`success_count = request_count`）但前端无感知。** 当用户选择 30d 时间范围时，Dashboard 的成功率卡片会显示 100%（因为走聚合表），即使实际有失败请求。这是数据语义错误——字段存储的值与其定义的语义不符。plan-api-contract 说"响应格式不变"，但实际语义已变。 | 两种方案：(A) 在聚合表中增加 `sum_success_count` 字段（需要 insertMetrics 时也写入 success 状态）— 但 spec FR-1 未包含此维度；(B) 前端在聚合段显示成功率时标注"approximate"或隐藏成功率指标，并在 API 响应中增加 `is_approximate: true` 标记。推荐方案 B，因为改动最小且符合 spec 约束。 |
| 4 | MUST FIX | plan-api-contract.md → metrics_detail_days 配置生命周期 | **查询路由函数读取 settings 的缓存策略未定义。** plan-api-contract 提到"settings 30s TTL 缓存"，但 plan-backend.md 的 BG3 查询路由改造中未说明如何获取 detailDays 值。是每次查询都 `getMetricsDetailDays(db)` 读 DB？还是有内存缓存？如果是内存缓存，用户在 Settings 修改 detailDays 后，查询路由最多延迟 30s 才生效，这期间清理逻辑可能已删除明细但查询路由仍认为有明细。导致跨越分界线的 UNION 查询读到空数据。 | plan-backend.md BG3 应显式声明：(1) `getMetricsDetailDays(db)` 的缓存策略（每次读 DB vs 内存 TTL vs lazy load）(2) Settings API 写入后如何通知查询路由刷新缓存（写入后清缓存 vs 事件通知）。建议用与现有 `getLogRetentionDays()` 一致的策略，确保一致性。 |
| 5 | MUST FIX | plan-backend.md → BG1 → UPSERT 语句 + 迁移 SQL | **聚合表主键含 6 列（bucket_time, router_key_id, provider_id, backend_model, client_type, api_type）且用 WITHOUT ROWID。** 问题：(1) 高基数组合导致主键索引体积大，WITH ROWID 对 8K 行量级更合适；(2) `router_key_id` 用空字符串替代 NULL，但如果其他表也引用 `router_key_id`（如 `request_metrics`），查询路由 UNION 时需要做 NULL ↔ '' 转换，容易遗漏出错。 | (1) 评估是否真的需要 WITHOUT ROWID。30 天 8K 行量级下，ROWID 模式 + 二级索引更灵活，空间差异可忽略。(2) 在 plan-backend.md 中显式列出所有涉及 `router_key_id` NULL/'' 转换的位置（UPSERT 写入、查询读取、UNION 合并），确保无遗漏。 |
| 6 | LOW | plan.md → Execution Groups → BG1 | BG1 同时包含：DB 迁移建表 + upsertMetrics10min 函数 + getMetricsDetailDays/setMetricsDetailDays + admin settings 端点。一个 subagent 做 4 件不同领域的事（DDL + CRUD + Settings + API 端点），出错概率较高。 | 考虑将 admin settings 端点拆到 BG4（与 activity 端点一起），BG1 只做 DB 层基础设施。 |
| 7 | LOW | plan-frontend.md → FG1.4 → useDashboard.ts | 移除 `aggregateAllProviderInputTokens` 后，provider token labels 改从 `getMetricsSummary()` 聚合。但 plan 未说明聚合表段的 `getMetricsSummary()` 是否已经按 provider 分组返回 token 数据（需确认 SQL 是否含 `GROUP BY provider_id`）。 | plan-backend.md BG3 的 getMetricsSummary 改造 SQL 已确认有 `GROUP BY m.provider_id`，所以数据来源是可行的。建议在 plan-frontend.md 中增加一行注释说明这一点。 |
| 8 | LOW | plan.md → Spec Coverage Matrix | FR-5（筛选维度）要求"所有筛选参数同时传递给明细表查询和聚合表查询"，但 Task 列表中无显式 Task 处理筛选参数的传递。BG3 查询路由改造隐含了筛选支持，但未显式提及。 | 在 BG3 Task 描述中增加"确保所有筛选参数（provider/model/key/client_type）同时传递给聚合表查询"的说明。 |
| 9 | INFO | plan-backend.md → BG4 → 活动图端点 | 30 天 × 144 桶/天 = 4320 条全量返回，无分页或 limit。对当前规模（8K 行）可接受，但如果未来聚合表增长（如 365 天 = ~50K 行），可能需要分页。 | 当前规模可接受。可在后续迭代中增加 limit 参数。 |
| 10 | INFO | e2e-test-plan.md → TS-4 | TS-4 查询路由测试需要验证"跨越分界线"场景，但测试依赖于设置 `metrics_detail_days = 7` 后实际时间流逝。如果测试执行时间 < 7 天，需要手动构造跨分界线数据。E2E 测试未说明如何构造。 | 建议在 TS-4 中补充说明：使用组件测试（`buildApp` + 内存 DB）构造不同时间段的测试数据，而非依赖真实时间。 |

---

## 等级判定校准说明

- Issue #1（数据丢失）：聚合数据静默丢失属于"数据丢失"类问题 → MUST FIX
- Issue #2（职责矛盾）：subagent 执行困惑会导致文件漏创建 → MUST FIX
- Issue #3（数据语义错误）：success_rate 100% 与实际不符属于"数据语义错误" → MUST FIX
- Issue #4（时序错误）：缓存不一致导致读到过期路由决策属于"时序错误" → MUST FIX
- Issue #5（设计风险）：主键设计影响写入性能和数据一致性 → MUST FIX

---

## 结论

需修改后重审。5 条 MUST FIX 需在 plan 修订中解决。

### Summary

计划评审第1轮，发现5条 MUST FIX（双写异常吞没、职责归属矛盾、success_rate 近似欺骗、缓存策略未定义、主键设计风险），3 条 LOW，2 条 INFO。需修订后重审。

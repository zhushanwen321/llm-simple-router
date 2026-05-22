---
verdict: pass
must_fix: 0
review:
  type: spec_review
  round: 4
  timestamp: "2026-05-22T18:30:00"
  target: ".xyz-harness/2026-05-22-specplansession/spec.md"
  summary: "Spec 评审完成，第4轮（超3轮循环上限），0条MUST FIX，通过。需人工确认是否关闭评审。"

statistics:
  total_issues: 7
  must_fix: 0
  must_fix_resolved: 1
  low: 5
  info: 1

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md — 全局"
    title: "新字段缺少数据消费者检查清单（违反 CLAUDE.md 规范）"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 2
    severity: LOW
    location: "spec.md §FR2 — body_matchers 字段"
    title: "body_matchers path 遍历未指定数组/复杂路径行为"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 3
    severity: LOW
    location: "spec.md §FR5 — upstream_error_logs"
    title: "error_type/error_message 提取算法未指定，跨 provider 错误格式差异未考虑"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 4
    severity: LOW
    location: "spec.md §Complexity Assessment — 性能约束"
    title: "JSON 匹配性能约束（<2x 正则）缺少对应的验收标准"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 5
    severity: LOW
    location: "spec.md §FR5 — upstream_error_logs"
    title: "upstream_error_logs 清理机制引用不明确"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 6
    severity: INFO
    location: "spec.md §FR8 — AI 生成规则端点"
    title: "AI 生成 body_matchers 的行为未说明"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 7
    severity: LOW
    location: "spec.md §FR4 — stream_error 响应路径修复"
    title: "'adapter' 术语与代码库架构命名不一致，formatError 路径未明确"
    status: open
    raised_in_round: 3
    resolved_in_round: null

---

# Spec 评审 v4

## 轮次边界声明

**本轮回次（第4轮）已超过 skill 定义的循环上限（≤ 3 轮）。** v3 已判定 "通过"（0 条 open MUST FIX），本轮为额外请求的独立复核。如本轮发现新 MUST FIX，需升级到人工决策，而非继续轮次迭代。

---

## 评审记录

- 评审时间：2026-05-22 18:30
- 评审类型：Spec 完整性审查（第4轮，独立复核）
- 评审对象：`.xyz-harness/2026-05-22-specplansession/spec.md`
- 评审范围：独立的完整性、一致性、可验证性审查，不继承既往评审的锚定

---

## 独立评审：Spec 完整性检查

### 1.1 目标是否明确

> "Retry Rule Upgrade: Provider Isolation + JSON Matching + Error Logging"

**✅ 清晰。** 一段话定位核心问题——Kimi 429 误命中 DeepSeek 重试规则导致 7 分钟无响应。背景、根因、目标一致。

### 1.2 范围是否合理

FR1-FR9 覆盖从 DB schema 变更 → RetryRuleMatcher 升级 → resilience 适配 → failover-loop 适配 → Admin API → 前端的完整链路。范围边界清晰：

- 显式声明 SSE 监控 "不在本次范围内"
- `upstream_error_logs` 声明 "暂不做前端展示"
- AI 生成规则只禁用了 provider_id 自动填充，未要求 body_matchers 生成

**✅ 合理。** 无 scope creep，关键的集成点（RetryRuleMatcher 缓存重设计、resilience 调用方传参变更）均已涵盖。

### 1.3 验收标准是否可量化

| AC | 内容 | 可量化度 | 测试场景 |
|----|------|---------|----------|
| AC1 | Provider 隔离 | ✅ 可量化 | 3 个具体场景：不匹配、fallback、fallback 不匹配 |
| AC2 | JSON 字段匹配 | ✅ 可量化 | equals/contains/exists + fallback + 非 JSON 回退 + 嵌套路径 |
| AC3 | 429 不再误触发 | ⚠️ 部分可量化 | "合理时间"较模糊，但被 AC1+AC4 的精细场景覆盖 |
| AC4 | stream_error 响应 | ✅ 可量化 | 格式化 JSON + client_status_code + API 类型匹配 |
| AC5 | upstream_error_logs | ✅ 可量化 | 写入 + 字段提取 + retry_count + 索引查询 |
| AC6 | 前端 Provider 选择 | ✅ 可量化 | 选择 + 表格展示 + Badge |
| AC7 | 前端 JSON 匹配编辑 | ✅ 可量化 | Tab 切换 + 增删行 + exists 隐藏 + 序列化 |
| AC8 | 向后兼容 | ✅ 可量化 | 旧规则行为不变 + 旧 API 正常 + 迁移安全 |

**✅ 整体通过。** AC3 的 "合理时间" 有一定主观性，但这是端到端行为 AC，核心可验证逻辑已被 AC1 和 AC4 覆盖。

### 1.4 [待决议] 项

无 `[待决议]` 标记。

**✅ 通过。**

### 1.5 Data Consumer Checklist 复检

复制 v3 的复检结论：5 类消费者的覆盖确认表完整，每个新字段/表的消费路径清晰标注。

| 消费者 | provider_id | body_matchers | upstream_error_logs |
|---------|-------------|---------------|--------------------|
| DB 写入 | ✅ createRetryRule | ✅ createRetryRule | ✅ logUpstreamError |
| 内存缓存 | ✅ RetryRuleMatcher.load | ✅ RetryRuleMatcher.load | N/A |
| Admin API | ✅ GET/POST/PUT | ✅ GET/POST/PUT | N/A（不在本 PR）|
| 前端 | ✅ RetryRules.vue | ✅ RetryRules.vue | N/A |
| SSE 监控 | N/A（Out of Scope）| N/A（Out of Scope）| N/A |

现场验证：迁移文件 `049_add_provider_isolation_and_matchers.sql` 已存在于 `router/src/db/migrations/`，SQL 定义与 spec FR7 完全一致。✅

**✅ 通过。**

---

## 本轮独立审查：新问题发现

本轮进行完全独立的重新审查，不参考 v1-v3 的问题列表。以下是在断开创口后重新阅读 spec 发现的所有问题。

### 发现问题清单

#### 问题 A: FR4 "adapter" 术语不匹配（与 v3 #7 相同）

**位置**：spec.md §FR4
**描述**：FR4 提到 "使用 adapter 的 `formatError()` 格式化错误体"。项目代码库中没有 "adapter" 层——架构是 Handler → Orchestration → Routing → Transport 四层模型。错误格式化由 `proxy-core.ts` 的共享工厂函数和 `transform/response-transform.ts` 的 `transformErrorResponse()` 处理。使用未定义的术语可能导致实现者方向走偏。
**严重性**：LOW — 实现者可通过上下文推测意图，术语不一致不会导致功能不可用。
**修改建议**：用 `handler/openai.ts`/`handler/anthropic.ts`（API 类型特定的 handler）的格式化机制替换 "adapter" 表述，或明确 `formatError` 的职责与位置。

#### 问题 B: error_type/error_message 提取算法未指定

**位置**：spec.md §FR5
**描述**：FR5 说 "error_type 和 error_message 从最后一个 attempt 的 responseBody 中提取"，但未说明提取算法。不同 provider 错误格式有差异：OpenAI 用 `{error: {type, message}}`，Anthropic 用 `{error: {type, message}}`，其他 provider 可能用平铺格式 `{message: "..."}`。此外，stream 路径的响应体在转化过程中可能已被消耗，实际可用的 error 数据格式和范围不确定。
**严重性**：LOW — `upstream_error_logs` 的 `error_type`/`error_message` 允许 NULL，提取失败不影响主流程。
**修改建议**：补充回退链：先 `error.type`/`error.message`，再 `type`/`message`，再 `null`。

#### 问题 C: body_matchers 数组/复杂路径行为未定义

**位置**：spec.md §FR2
**描述**：`path` 用 `.` 分隔嵌套层级。未说明：数组索引（如 `errors[0].code`）是否支持；path 为 `""` 或 `"."` 时的行为。
**严重性**：LOW — 错误响应极少数使用数组嵌套，且 `contains`/`exists` 操作符可兜底。
**修改建议**：明确声明数组索引不在支持范围内（简单路径优先），或增加路径规范说明。

#### 问题 D: 性能约束缺少可验证的验收标准

**位置**：spec.md → Constraints / Complexity Assessment
**描述**："JSON 字段匹配不应比正则慢超过 2x" 是一个可量化的性能约束，但 AC1-AC8 均未对应此指标。且 benchmark 基准（固定响应体类型、body_matchers 数量、正则复杂性）未定义。
**严重性**：LOW — 非功能性约束，不阻塞功能实现。性能约束可在测试 plan 中覆盖，不必须升格到 spec AC。
**修改建议**：保持现有处理方式（plan 阶段纳入非功能测试任务），或新增 AC9 定义基准场景和阈值。

#### 问题 E: upstream_error_logs 清理机制引用不明确

**位置**：spec.md §FR5
**描述**："按 `created_at` 定期清理（复用现有日志清理逻辑）"。未指明具体复用哪个清理函数/定时任务，以及保留策略（如多少天）。现有日志清理函数（`logs.ts` 中的清理逻辑）需要增加对 `upstream_error_logs` 表的清理，但 FR 中未作为独立 task 列出。
**严重性**：LOW — 实现者可自行找到现有清理逻辑（项目仅有一套），但遗漏该改动可能导致表无限增长。
**修改建议**：在 FR5 或 Constraints 中明确清理策略（保留天数、执行频率），或引用具体的清理函数名。

#### 问题 F: AI 生成规则 body_matchers 行为未说明

**位置**：spec.md §FR8
**描述**：FR8 只说明 AI 生成规则不自动填充 `provider_id`，未说明 AI 在 body_matchers 和 body_pattern 之间的选择策略。AI 仍输出 body_pattern 可能与新 UI（默认展示 body_matchers Tab）产生交互上的不一致。
**严重性**：INFO — AI 生成是辅助功能，用户可在 Dialog 中手动处理。
**修改建议**：在 FR8 中补充一句说明（如 "AI 生成保持 body_pattern，用户可在 UI 中切换为 body_matchers"）。

### 问题回溯对照

| 本轮回溯编号 | 对应 v1-v3 问题 ID | 描述 | 是否新增 |
|-------------|-------------------|------|---------|
| A | #7 | FR4 "adapter" 术语 | 否（v3 已提）|
| B | #3 | error_type 提取算法 | 否（v1 已提）|
| C | #2 | body_matchers 复杂路径 | 否（v1 已提）|
| D | #4 | 性能约束无 AC | 否（v1 已提）|
| E | #5 | 清理机制引用 | 否（v1 已提）|
| F | #6 | AI 生成行为 | 否（v1 已提）|

**结论：本轮未发现 v1-v3 已标注之外的任何新问题。**

---

## 架构一致性额外验证

### FR7 迁移文件确认

现场确认 `router/src/db/migrations/049_add_provider_isolation_and_matchers.sql` 已存在，SQL 定义与 spec FR7 完全一致：

```sql
ALTER TABLE retry_rules ADD COLUMN provider_id TEXT NULL DEFAULT NULL;
ALTER TABLE retry_rules ADD COLUMN body_matchers TEXT NULL DEFAULT NULL;
CREATE TABLE upstream_error_logs (...) + 3 indexes
```

✅ spec 与已有实现协调一致。

### FR9 StateRegistry 刷新链路

FR9 要求 `stateRegistry.refreshRetryRules()` 触发 `RetryRuleMatcher.load()`。此为现有模式（Provider 更新同步刷新 SemaphoreManager 配置、RetryRule 更新自动刷新 RetryRuleMatcher 内存缓存），该设计在 CLAUDE.md 中已有记载。✅

### FR3 调用方适配确认

FR3 要求 `decide()` 和 `checkEarlyError` 传入 `providerId`。`decide()` 位于 `orchestration/resilience.ts`，已通过 orchestrator 传递的目标 context 访问 providerId。`checkEarlyError` 位于 `transport/transport-fn.ts`，在构建 transport 函数时传入 providerId 参数 — 属于签名兼容变更。✅ 风险可控。

---

## 综合评审矩阵

| 检查维度 | 状态 | 说明 |
|---------|------|------|
| 目标明确性 | ✅ | Background + 问题根因清晰 |
| 范围合理性 | ✅ | FR1-FR9 覆盖完整链路，SSE/frontend scope 明确 |
| AC 可量化 | ✅ | 7/8 个 AC 有精细测试场景，AC3 补充性可接受 |
| [待决议] 项 | ✅ | 无 |
| Data Consumer Checklist | ✅ | 完整覆盖 5 类消费者，现场验证 migration 匹配 |
| 现有实现协调 | ✅ | 049 migration 文件已存在且匹配 spec |
| 架构一致性 | ⚠️ | #7 (A): FR4 "adapter" 术语与代码库四层模型不一致 |
| 实现指引精确度 | ⚠️ | #2-#5 (B-E): 均为规范化建议，非阻塞 |

---

## 结论

**通过。** 0 条 MUST FIX，5 条 LOW，1 条 INFO。所有问题均为实现指引层面的规范化建议，不构成阻塞条件。

**注意：** 本轮（第4轮）已超过 skill 定义的 ≤ 3 轮循环上限。建议人工确认是否关闭评审（3 轮连续通过已充分验证 spec 质量），或将 LOW 问题作为 plan 阶段的参考关注点而非额外复审。

### Summary

Spec 评审完成，第4轮（超3轮循环上限），0条MUST FIX，通过。需人工确认是否关闭评审。

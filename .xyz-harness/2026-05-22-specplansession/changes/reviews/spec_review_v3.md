---
verdict: pass
must_fix: 0
review:
  type: spec_review
  round: 3
  timestamp: "2026-05-22T18:15:00"
  target: ".xyz-harness/2026-05-22-specplansession/spec.md"
  summary: "Spec 评审完成，第3轮，0条MUST FIX，通过"

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

# Spec 评审 v3

## 评审记录

- 评审时间：2026-05-22 18:15
- 评审类型：Spec 完整性审查（第3轮，独立复核）
- 评审对象：`.xyz-harness/2026-05-22-specplansession/spec.md`
- 评审依据：CLAUDE.md 架构约束 + docs/ 编码规范

---

## 总体评价

本轮为第3轮独立复核。v2 已确认 MUST FIX #1 修复通过，v3 在继承 v2 全部 6 个问题的基础上，进行**全新的独立审查**。在逐项复检中发现 1 个此前未标注的新问题（#7：FR4 术语不一致），其余 LOW/INFO 问题经复检确认无需升级。

**结论：通过。** 0 条 open MUST FIX。仅新增 1 条 LOW 问题，建议在 plan 或实现前明确。

---

## 1. Spec 完整性（逐项检查）

### 1.1 目标是否明确

> "Retry Rule Upgrade: Provider Isolation + JSON Matching + Error Logging"

✅ **通过。** 一段话说清楚——解决重试规则误命中，增加 provider 隔离、JSON 字段匹配、错误日志。Background 章节用具体的 Kimi 429 案例追溯了根因，上下文充分。

### 1.2 范围是否合理

FR1-FR9 覆盖从 DB Schema → Matcher → resilience → failover-loop → Admin API → 前端的完整链路。没有范围过大（未额外重构无关组件）或过小（遗漏关键依赖链）的问题。

✅ **通过。** 范围合理，边界清晰。Complexity Assessment 中标注的"关键依赖链"与 FR 定义的依赖关系一致。

### 1.3 验收标准是否可量化

AC1-AC8 均包含具体测试场景描述。以 AC2 为例：

- `equals`: 精确匹配 — 可写 assertEqual
- `contains`: 子串匹配 — 可写 assertInclude
- `exists`: 字段存在 — 可写 hasOwnProperty
- fallback 行为 — 可写 assert behavior when body_matchers is NULL
- 非 JSON 回退 — 可写 assert fallback

✅ **通过。** 所有 AC 可写测试验证。

### 1.4 [待决议] 项

无 `[待决议]` 标记。

✅ **通过。**

---

## 2. 新问题发现

### 2.1 新增 LOW #7: FR4 "adapter" 术语与代码库架构不一致

**定位**：spec.md §FR4 — stream_error 响应路径修复

**描述**：
FR4 原文："使用 adapter 的 `formatError()` 格式化错误体，设置 `content-type: application/json`"

项目 CLAUDE.md 定义的架构是四层模型：**Handler → Orchestration → Routing → Transport**，代码库中不存在 "adapter" 层。错误格式化相关的现有基础设施是：
- `proxy-core.ts` — 共享错误格式化工厂
- `transform/response-transform.ts` — `transformErrorResponse`（按 API 类型格式化）

引入 "adapter" 这个未定义的术语可能产生两方面的混淆：
1. 实现者不知道该去哪里找 `formatError()`——是 handler 层、proxy-core 还是 transform 层？
2. `formatError` 这个函数名本身在现有代码库中不存在，需要新增——但 spec 未说明它应该放在哪里、接受什么参数。AC4 要求"错误响应格式与客户端 API 类型匹配（anthropic/openai 格式）"，说明该函数需要感知 API 类型，但 `sendResponse()` 在 Orchestration 层是否有 access 到 API 类型信息（openai vs anthropic）？这在 current orchestrator architecture 中可能需要额外参数传递。

**风险判断**：LOW
- 这个问题在生产环境中不会**直接**导致功能不可用（实现者最终能通过上下文推测出意图）
- 但 spec 中使用了代码库不存在的术语且未定义，属于实现指引的精确度问题
- 建议在 FR4 中明确：`formatError` 具体指哪个函数（如 `transformErrorResponse` 或新增的 handler-level 格式化函数），以及 `formatError` 如何获取 API 类型信息

---

## 3. 遗留问题重新评估（LOW/INFO 升级判断）

v1/v2 遗留的 4 条 LOW + 1 条 INFO，本轮逐条重新评估是否需要升级为 MUST FIX：

### LOW #2: body_matchers path 未指定数组/复杂路径行为

**本轮回溯判断**：维持 LOW。

原因：
- spec 明确定义了 `path` 用 `.` 分隔嵌套层级，配合 `equals`/`contains`/`exists` 三种操作符，对简单嵌套对象（如 `error.type`）的覆盖足够
- 错误响应体几乎从不使用数组嵌套（`{error: {type, message}}` 是 industry standard）
- 即使遇到，`path: "errors"` + `exists` 或 `contains` 也可以兜底

**触发 MUST FIX 的条件**：如后续发现上游返回含数组的错误体（如 `errors[0].code`），且 body_matchers 无法匹配，则需升级。当前无证据。

### LOW #3: error_type/error_message 提取算法未指定

**本轮回溯判断**：维持 LOW。

原因：
- 主流 provider 错误格式统一（`{error: {type, message}}`），实现时可统一采用此路径
- `upstream_error_logs` 表定义中 `error_type` 和 `error_message` 都设为 TEXT NULL，允许部分缺失
- Complexity Assessment 已将此项标注为"低风险"

### LOW #4: JSON 匹配性能约束缺少验收标准

**本轮回溯判断**：维持 LOW。

原因：
- 性能约束是非功能性要求，通常不纳入功能 AC 矩阵
- 该约束强度不高（"不超过 2x"），轻微超标不导致功能问题
- 可在 E2E 计划或 workload benchmark 中覆盖

### LOW #5: upstream_error_logs 清理机制引用不明确

**本轮回溯判断**：维持 LOW。

原因：
- 项目仅有一套日志清理逻辑（参考 CLAUDE.md 的数据表描述），实现者自然能找到
- 清理策略与现有日志一致（保留天数/清理频率），风险极低

### INFO #6: AI 生成 body_matchers 未说明

**本轮回溯判断**：维持 INFO。

原因：
- AI 生成规则是边缘辅助功能，不是核心流程
- 即使 AI 生成的规则使用 `body_pattern`，用户可在 Dialog 中手动切换为 `body_matchers`
- 保持 `body_pattern` 作为默认行为符合向后兼容原则

---

## 4. Data Consumer Checklist 复检

v2 新增的 Data Consumer Checklist 章节在本轮重新复核：

### 覆盖确认表

| 消费者 | provider_id | body_matchers | upstream_error_logs |
|---------|-------------|---------------|--------------------|
| DB 写入 | ✅ createRetryRule | ✅ createRetryRule | ✅ logUpstreamError |
| 内存缓存 | ✅ RetryRuleMatcher.load | ✅ RetryRuleMatcher.load | N/A |
| Admin API | ✅ GET/POST/PUT | ✅ GET/POST/PUT | N/A（不在本 PR）|
| 前端 | ✅ RetryRules.vue | ✅ RetryRules.vue | N/A |
| SSE 监控 | N/A (Out of Scope) | N/A (Out of Scope) | N/A |

### 复核发现

✅ **DB 写入**：INSERT 语句包含 provider_id 和 body_matchers 列，logUpstreamError 为新增函数——正确。

✅ **内存缓存**：`RetryRuleMatcher.load()` 已标注为新缓存结构（provider_id + status_code 二级分组）——正确。

✅ **Admin API**：`RETRY_FIELDS` 白名单已添加新字段——遵循了项目中 `helpers.ts` 的白名单模式。

✅ **前端**：RetryRules.vue 同时覆盖展示和编辑——正确。

✅ **SSE 监控**：明确标注 Out of Scope——正确。`upstream_error_logs` 的"不在本 PR"标注也清晰。

**针对 upstream_error_logs 的 N/A 标注复查**：`upstream_error_logs` 在 Admin API 和前端标注为 "N/A（不在本 PR）"，这与 FR5 的"暂不做前端展示"一致。虽然是本 PR 新建的表，但仅做写入，不做读取展示——行为符合预期。✅

---

## 5. 综合评审矩阵

| 检查维度 | 状态 | 说明 |
|---------|------|------|
| 目标明确性 | ✅ | Background + FR1-FR9 清楚定位 |
| 范围合理性 | ✅ | 覆盖完整链路，无 scope creep |
| AC 可量化 | ✅ | 均含具体测试场景 |
| [待决议] 项 | ✅ | 无 |
| Data Consumer Checklist | ✅ | 完整覆盖，v2 已修复 |
| 架构一致性 | ⚠️ | #7: FR4 "adapter" 术语不匹配 |
| 实现指引精确度 | ⚠️ | #2-#5 见上，均为 LOW |

---

## 结论

**通过。** 0 条 MUST FIX，1 条新增 LOW（#7：FR4 术语一致性），4 条遗留 LOW（#2-#5），1 条 INFO（#6）。所有 LOW/INFO 均为实现指引层面的优化建议，不构成阻塞条件。

### Summary

Spec 评审完成，第3轮，0条MUST FIX，通过。

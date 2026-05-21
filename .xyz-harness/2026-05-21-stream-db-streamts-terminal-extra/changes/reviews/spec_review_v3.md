---
verdict: pass
must_fix: 0
review:
  type: spec_review
  round: 3
  timestamp: "2026-05-21T06:35:00"
  target: ".xyz-harness/2026-05-21-stream-db-streamts-terminal-extra/spec.md"
  summary: "Spec 评审完成，第3轮通过，0条 MUST FIX，4条 LOW/INFO 仍未解决（spec 未更新）"

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
    title: "buildUpdateQuery 用于 INSERT 的提法不准确（已代码验证：insertRequestLog 使用手写 INSERT SQL）"
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

# Spec 评审 v3（第3轮）

## 评审记录
- 评审时间：2026-05-21 14:35
- 评审类型：Spec 评审
- 评审对象：`spec.md`
- 评审轮次：第 3 轮

---

## 本轮变更检查

与 v2 相比，**spec.md 无实质变更**。v2 中 4 条 open issues（#7 LOW、#8 LOW、#9 INFO、#10 INFO）均未修复。

---

## 各维度评估

### 1. 目标明确性 ✅ —— 通过

Background 清晰地阐述了 P1/P2/P3 三类问题，FR1-FR8 逐一对应。一段话能完整概括目标："持久化 8 个运行时诊断字段到 request_logs 表 + 修复 ModelCard.vue 超时输入框显示条件"。

### 2. 范围边界 ✅ —— 通过

Out of Scope 列出 6 项排除项，边界清晰。Data Consumer Checklist 明确了哪些消费者在本次范围内、哪些不在。

### 3. 验收标准可量化 ✅ —— 通过

8 个 AC 全部可写测试验证。建议在 plan 阶段处理 #7/#8 的覆盖率。

### 4. [待决议] 项 ✅ —— 无风险

无显式 `[待决议]` 标记。FR6 的"spec 阶段不锁定枚举"是合理的设计决策，已在 v2 中评估为可接受。

### 5. 约束条件 ✅ —— 通过

6 条约束全部具体明确，无歧义。

### 6. 数据消费者清单 ✅ —— 已满足

已覆盖 4 类消费者并标注了 in scope / out of scope status。

---

## 上一轮 Open Issues 状态

### Issue #7（LOW）— AC5 未覆盖 "abort" 和 "done" 路径 🔴 未修复

**当前 AC5**：
  - retry ✅
  - failover ✅
  - IS NULL ✅
  - abort ❌ 缺失
  - done ❌ 缺失

**状态**: spec 未修改，仍为 3 条子条件。建议在 plan 阶段补充 `abort` 和 `done` 路径的 AC，或在 plan 中说明这两种路径不会被持久化到 DB（如 `done` 只是内部状态标记）。

### Issue #8（LOW）— AC6 未覆盖 failover_retry 🔴 未修复

**当前 AC6**：
  - direct_format ✅
  - group_base_rule ✅
  - overflow_redirect ✅
  - failover_retry ❌ 缺失

**状态**: spec 未修改。建议在 plan 阶段补充 `failover_retry` 的 AC，或在 FR6 中明确从枚举中移除。

### Issue #9（INFO）— buildUpdateQuery 提法不准确 🔴 未修复

**代码验证**：
- `buildUpdateQuery()` 存在于 `router/src/db/helpers.ts:20`，但**仅用于 UPDATE**
- `insertRequestLog()` 在 `router/src/db/logs.ts:91` 使用手写 `INSERT INTO request_logs (id, api_type, model, ...)` SQL
- 新列需要添加到该手写 INSERT 语句的列名列表中

**当前 spec 文字**："`insertRequestLog()` SQL 已覆盖（使用 `buildUpdateQuery` 白名单模式）。无需新增 SQL 语句。"

**误导性**：该描述会导致实现者以为已有基础设施自动处理新列写入。实际上需要手动修改 INSERT SQL。建议修正。

### Issue #10（INFO）— headers_sent 数据流起点未追溯 🔴 未修复

Data Consumer Checklist 中 `headers_sent` 标注来源为 `ResilienceAttempt.headers_sent`，但实际数据起点在 Transport 层（StreamProxy），需要先传递到 error/TransportResult 对象，再由 catch 块提取填入 ResilienceAttempt。建议补全或标注"由 plan 阶段处理"。

---

## 新发现问题

本轮未发现新的 MUST FIX、LOW 或 INFO 问题。spec 在 v1→v2 的改进已使其达到良好质量。

---

## 结论

**通过**。0 条 MUST FIX，2 条 LOW（建议性），2 条 INFO（观察性）。

v2 遗留的 4 条 open issues 均为 LOW/INFO，不阻碍流程。建议在 plan 阶段：
1. 处理 AC 覆盖率（#7、#8）—— 决定是否需要补充或明确排除
2. 修正验证方式描述（#9）—— 更新为"需将新列添加到 `insertRequestLog()` 的手写 INSERT SQL 列名列表中"
3. 规划 headers_sent 数据流（#10）—— 在 plan 中明确从 transport 层到 DB 的完整传递路径

---

## Summary

Spec 评审完成，第3轮通过，0条 MUST FIX，4条 LOW/INFO 遗留（spec 未变化，不影响流程进行）。

---
verdict: pass
must_fix: 0
---
  must_fix_resolved: 1
  low: 4
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
---

# Spec 评审 v2

## 评审记录

- 评审时间：2026-05-22 18:00
- 评审类型：计划评审（Spec 完整性审查，第2轮）
- 评审对象：`.xyz-harness/2026-05-22-specplansession/spec.md`
- 评审范围：MUST FIX #1 修复验证 + LOW 问题是否需要升级

---

## 重点检查：MUST FIX #1 修复验证

### 修复内容

v2 spec 在 `## Acceptance Criteria` 之后新增了 **Data Consumer Checklist** 章节，包含 5 类消费者分析和一个覆盖确认表：

| 消费者类别 | provider_id | body_matchers | upstream_error_logs |
|-----------|-------------|---------------|--------------------|
| DB 写入 | ✅ createRetryRule | ✅ createRetryRule | ✅ logUpstreamError |
| 内存缓存 | ✅ RetryRuleMatcher.load | ✅ RetryRuleMatcher.load | N/A |
| Admin API | ✅ GET/POST/PUT | ✅ GET/POST/PUT | N/A（不在本 PR）|
| 前端 | ✅ RetryRules.vue | ✅ RetryRules.vue | N/A |
| SSE 监控 | N/A（Out of Scope）| N/A（Out of Scope）| N/A |

### 验证结论

✅ **MUST FIX #1 已修复**。补充了完整的 Data Consumer Checklist，每个新增字段/表的消费路径清晰标注，符合 CLAUDE.md 规范。

额外说明：
- `upstream_error_logs` 标注为不在 Admin API/前端/SSE 范围——合理（spec 明确说"暂不做前端展示"）
- SSE 监控标注为 Out of Scope——合理，表不是本 PR 新增的
- 覆盖确认表中的"不在本 PR"标注清晰避免了实现范围的误会

---

## LOW/INFO 问题检查：是否需要升级

逐条评估 v1 遗留的 4 条 LOW 和 1 条 INFO，确认是否需要升级为 MUST FIX：

### LOW #2: body_matchers path 未指定数组/复杂路径行为

**现状**：FR2 仍仅定义 `path` 用 `.` 分隔嵌套层级，未说明数组索引（如 `errors[0].code`）或 JSON Pointer 等复杂路径的处理方式。

**升级判断**：不需要升级。

原因：
- 错误响应的 body 结构通常为简单嵌套对象（如 `{error: {type, message}}`），极少包含数组路径
- 即使遇到包含数组的响应体，`path: "errors"` 配合 `exists` 或 `contains` 操作符即可覆盖大部分场景
- 实现阶段可自然处理（实际实现时基于 JSON 对象遍历，数组元素可以视为不匹配或跳过）
- 这是一个行为**规范化**问题，不是功能缺失问题

### LOW #3: error_type/error_message 提取算法未指定

**现状**：FR5 仍只写 "从最后一个 attempt 的 responseBody 中提取"，未说明具体的字段提取策略。

**升级判断**：不需要升级。

原因：
- 主流 provider（OpenAI、Anthropic）的错误格式都是 `{error: {type, message}}`，实现时可统一采用此路径
- spec 的 Complexity Assessment 已标注此部分风险为 **低**
- 即使提取算法有偏差，`upstream_error_logs` 表定义中 `error_type` 和 `error_message` 都是 TEXT NULL，允许部分缺失
- 实现时可以选择通用方案，测试环节可以覆盖多种 provider 格式

### LOW #4: JSON 匹配性能约束缺少验收标准

**现状**：Complexity Assessment 中声明 "JSON 字段匹配不应比正则慢超过 2x"，但 AC1-AC8 均未对应此约束。

**升级判断**：不需要升级。

原因：
- 性能约束是非功能性要求，通常不在 spec AC 中体现（AC 侧重于功能验证）
- 该约束的强度不高（"不超过 2 倍"），即使在实际实现中轻微超标也不会导致功能问题
- 可以在 E2E 测试计划或 plan 的测试任务中包含此项，而非必须上升到 spec AC
- 符合 CLAUDE.md 中 "测试评审以 AC 覆盖矩阵为依据"——AC 矩阵只要求功能 AC

### LOW #5: upstream_error_logs 清理机制引用不明确

**现状**：FR5 仍写 "按 `created_at` 定期清理（复用现有日志清理逻辑）"，未指明具体复用了哪个逻辑。

**升级判断**：不需要升级。

原因：
- 清理逻辑是**现有基础设施**，实现者自然能找到（项目只有一套日志清理逻辑，在 `logs.ts` 或类似的定时任务中）
- 项目的 CLAUDE.md 罗列了 `src/db/` 的所有文件，包含 `logs.ts`
- 如果清理策略需要与现有日志一致（保留天数/清理频率相同），则实现风险极低
- 此问题属于实现指引的精确度问题，不影响 spec 的可行性判断

### INFO #6: AI 生成规则端点如何处理 body_matchers 未说明

**复审核验**：FR8 原文："AI 生成规则端点：生成结果不自动填充 provider_id（需用户手动绑定）"。仍未提及 body_matchers。

**升级判断**：不需要升级。

原因：
- AI 生成规则是辅助功能，不是核心流程
- 即使 AI 生成的规则使用 body_pattern 而非 body_matchers，用户也可以在 Dialog 中手动切换
- 保持 `body_pattern` 作为 AI 生成的默认行为符合向后兼容原则
- 这是一个边缘功能的文档补充，不影响任何核心 AC

---

## 综合结论

| 检查维度 | 状态 |
|---------|------|
| Spec 目标明确 | ✅ 清晰 |
| 范围合理 | ✅ 覆盖完整链条 |
| AC 可量化 | ✅ 所有 AC 有具体测试场景 |
| [待决议] 项 | ✅ 无 |
| MUST FIX 修复 | ✅ #1 已修复 |
| LOW 升级判断 | 无需升级，维持 LOW |

### 结论

**通过**。MUST FIX #1 已完全修复，新增的 Data Consumer Checklist 完整覆盖所有新字段/表的消费路径。4 条 LOW 问题和 1 条 INFO 问题均属于实现指引层面的优化建议，不构成阻塞条件，无需额外轮次。

### Summary

Spec 评审完成，第2轮，0条MUST FIX，通过。

---
review:
  type: spec_review
  round: 1
  timestamp: "2026-05-22"
  target: ".xyz-harness/2026-05-22-1-provider2providerprovider2-json3-tooluse200code/spec.md"
  verdict: fail
  summary: "Spec 评审完成，第1轮，1条MUST FIX，需修改后重审"

statistics:
  total_issues: 6
  must_fix: 1
  must_fix_resolved: 0
  low: 4
  info: 1

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md — 全局"
    title: "新字段缺少数据消费者检查清单（违反 CLAUDE.md 规范）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
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

# Spec 评审 v1

## 评审记录

- 评审时间：2026-05-22
- 评审类型：计划评审（Spec 完整性审查）
- 评审对象：`.xyz-harness/2026-05-22-1-provider2providerprovider2-json3-tooluse200code/spec.md`
- 评审范围：spec 本身的完整性、一致性、可验证性，不涉及实现细节

## 总体评价

总体而言，这份 spec 质量很高。背景清晰，9 项功能需求（FR1-FR9）划分合理，匹配优先级定义明确，验收标准（AC1-AC8）有具体的测试场景描述，DB schema 有 DDL 示例。约束条件和复杂度评估也很务实。

主要问题是**缺少数据消费者检查清单**——这是 CLAUDE.md 硬性要求（"新字段数据消费者检查：任何消费者遗漏即视为 MUST FIX"），本次 spec 新增了 3 个 DB 列（`provider_id`、`body_matchers`）和 1 张新表（`upstream_error_logs`），但未以显式清单列出所有消费路径并逐一验证。其余问题均为 LOW/INFO 级别，不影响核心功能理解。

### 1. Spec 完整性

#### 目标明确性 ✅

> "Retry Rule Upgrade: Provider Isolation + JSON Matching + Error Logging"

目标清晰，一句话说清楚要做什么——解决重试规则误命中问题，增加 provider 隔离、JSON 字段匹配和错误日志。

#### 范围合理性 ✅

9 项功能需求（FR1-FR9）覆盖了从 DB schema 到前端 UI 的完整链条。没有明显的范围问题。

#### 验收标准可量化 ✅

AC1-AC8 均包含具体的测试场景描述，如：

- AC1 列出了 3 个测试场景（绑定规则隔离、通用规则 fallback、绑定规则不匹配时 fallback）
- AC2 列出了 4 个测试场景（Kimi 429 匹配、非 JSON fallback、多条件 AND）

所有 AC 均可通过单元测试或集成测试验证。**唯一例外**参见 LOW 级问题 #4。

#### [待决议] 项 ❌

无 `[待决议]` 标记。完整。

---

## 发现的问题

| # | 优先级 | 位置 | 描述 | 修改建议 |
|---|--------|------|------|---------|
| 1 | **MUST FIX** | spec.md — 全局 | **新字段缺少数据消费者检查清单**。CLAUDE.md 明确规定："新增 DB 列或 metadata 字段时，必须在 spec 阶段列出所有数据消费者并逐一验证。任何消费者遗漏即视为 MUST FIX。" 本 spec 新增了 `retry_rules` 表的 `provider_id`、`body_matchers` 两列，以及全新的 `upstream_error_logs` 表，但未以显式清单形式列出所有消费路径（DB 写入、内存缓存加载、Admin API CRUD、前端展示、SSE 监控、日志清理等）。虽然从各 FR 的描述中可以推理出消费者，但这种隐式覆盖方式无法确保无遗漏。 | 新增「数据消费者清单」章节，以列表形式列出每个新字段/新表的全部消费点，逐一标注每个消费者在 spec 中的对应位置。 |
| 2 | LOW | spec.md §FR2 | **body_matchers path 遍历未指定数组/复杂路径行为**。FR2 定义了 `path` 用 `.` 分隔嵌套层级，但未说明是否支持数组索引（如 `errors[0].code`）或其他复杂 JSON 路径。如果上游返回包含数组的响应体，body_matchers 可能会漏匹配。 | 在 FR2 中补充说明数组路径的支持情况（支持/不支持），或明确 scope 限定为仅适用简单嵌套对象。 |
| 3 | LOW | spec.md §FR5 | **error_type/error_message 提取算法未指定**。FR5 说 "error_type 和 error_message 从最后一个 attempt 的 responseBody 中提取"，但未说明提取算法。不同 provider 的错误格式虽有相似性但仍有差异（OpenAI: `{error: {type, message}}`，Anthropic: `{error: {type, message}}`，可能还有简化格式 `{message: "..."}`）。 | 补充提取逻辑说明，如：先尝试 `error.type`/`error.message`，再尝试直接顶层 `message`，或引用已有的错误解析工具函数。 |
| 4 | LOW | spec.md — Complexity Assessment | **JSON 匹配性能约束缺少对应的验收标准**。Complexity Assessment 中声明了 "JSON 字段匹配不应比正则慢超过 2x"，但 AC1-AC8 均为功能性验收标准，没有一条对应此性能约束。导致该约束无法在测试中验证。 | 新增 AC9：性能验收标准，附基准测试场景（如固定响应体 + N 条 matchers 的匹配耗时对比）。 |
| 5 | LOW | spec.md §FR5 | **upstream_error_logs 清理机制引用不明确**。FR5 说 "按 `created_at` 定期清理（复用现有日志清理逻辑）"，但未指明具体复用了哪个清理逻辑（`request_logs` 的清理？`request_metrics` 的清理？定时任务？）。不同清理逻辑的保留期限和触发机制不同，不加说明可能导致 implementation discrepancy。 | 明确引用现有清理逻辑的文件路径或函数名，并说明清理策略是否与现有日志一致。 |
| 6 | INFO | spec.md §FR8 | **AI 生成规则端点如何处理 body_matchers 未说明**。FR8 指定 AI 生成规则不会自动填充 `provider_id`，但未说明在 body_matchers 出现后，AI 生成的结果是包含 body_matchers 还是 body_pattern，还是两者皆有。 | 在 FR8 或对应位置补充说明 AI 生成器在 body_matchers 存在时的行为偏好。 |

### 问题等级判定校准

对 #1（数据消费者清单缺失）的 MUST FIX 判定依据：

- **CLAUDE.md 明确规则**：新增 DB 列必须列出所有消费者并逐一验证，"任何消费者遗漏即视为 MUST FIX"
- **实际风险**：缺少清单导致消费者漏检是项目中已验证的风险模式（CLAUDE.md 本身记录了 "cache_read_tokens_estimated 漏了实时监控同步" 的历史案例）
- **符合判定口诀**：该问题如果在生产环境中被遗漏，可能导致某个消费路径（如 SSE 监控推送、日志清理）未覆盖新字段，引发数据不一致

### 结论

**需修改后重审**。1 条 MUST FIX（数据消费者清单缺失），4 条 LOW，1 条 INFO。

### Summary

Spec 评审完成，第1轮，1条MUST FIX，需修改后重审。

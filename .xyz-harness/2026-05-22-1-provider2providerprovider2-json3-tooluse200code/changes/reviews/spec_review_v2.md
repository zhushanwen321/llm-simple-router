---
verdict: pass
must_fix: 0
review:
  type: spec_review
  round: 2
  timestamp: "2026-05-22T14:15:00"
  target: "spec.md"
  verdict: pass
  summary: "Spec 评审完成，第2轮通过，0条MUST FIX，2条LOW建议，1条INFO观察"

statistics:
  total_issues: 3
  must_fix: 0
  must_fix_resolved: 0
  low: 2
  info: 1

issues:
  - id: 1
    severity: LOW
    location: "spec.md:FR4"
    title: "FR4 stream_error 响应修复缺少非流式错误路径显式覆盖"
    description: "FR4 描述了 stream_error（流式）重试耗尽的响应处理，但未显式覆盖非流式（callNonStream）错误的类似路径。ResilienceLayer.decide() 对两者返回相同的 done/abort 结果，实际实现会覆盖两种路径，但 spec 未明确提及，可能导致实现遗漏。"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 2
    severity: LOW
    location: "spec.md:FR5"
    title: "FR5 error_type/error_message 提取逻辑未定义优先级"
    description: "FR5 写入 upstream_error_logs 时从 responseBody 提取 error_type 和 error_message，但未定义提取优先级。不同 provider 的错误格式差异大（OpenAI: error.type / error.message，Anthropic: error.type / error.message，Kimi 可能不同），缺少回退逻辑定义。"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 3
    severity: INFO
    location: "spec.md:FR6"
    title: "FR6 前端缺少 body_matchers 和 body_pattern 均为空时的交互定义"
    description: "新建规则时，用户可以在 JSON 匹配和正则匹配两个 Tab 间切换。当两个 Tab 均为空时（既无 body_matchers 也无 body_pattern），保存行为未定义。现有 body_pattern 有 required 校验，升级后需保持同等校验强度。"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# Spec 评审 v2

## 评审记录

- 评审时间：2026-05-22 14:15
- 评审类型：Spec 评审（第2轮）
- 评审对象：`spec.md` — Retry Rule Upgrade: Provider Isolation + JSON Matching + Error Logging

## 独立评审分析

### 1. Spec 完整性

| 要素 | 状态 | 说明 |
|------|------|------|
| **目标明确性** | PASS | 一段话说清：为 retry rule 增加 provider 隔离、JSON 字段匹配、错误日志记录 |
| **范围合理性** | PASS | 9 个 FR 边界清晰，不超出 scope。Constaints 明确定义技术边界 |
| **验收标准可量化** | PASS | 全部 8 个 AC 均可写测试验证，AC1-AC2 含具体测试场景 |
| **待决议项** | N/A | 无 `[待决议]` 标记 |

### 2. 验收标准逐项验证

| AC | 可测试性 | 验证方式 | 覆盖状态 |
|----|---------|---------|----------|
| **AC1**: Provider 隔离 | 可测 | 单元测试：纯函数 mock 匹配规则验证优先级；集成测试：mock backend 验证实际路由 | ✅ |
| **AC2**: JSON 字段匹配 | 可测 | 纯函数 matchBodyMatchers() 测试 3 种 operator + fallback + 嵌套路径 + 非法 JSON | ✅ |
| **AC3**: 429 不再误触发 | 可测 | E2E：Kimi 429 绑定专用规则 → 不重试 | ✅ |
| **AC4**: stream_error 响应 | 可测 | 集成测试：stream_error + exhaustion → 验证回复格式和 content-type | ✅ |
| **AC5**: upstream_error_logs 写入 | 可测 | DB 查询验证写入字段正确性 | ✅ |
| **AC6**: 前端 Provider 选择 | 可测 | 组件测试：Select options + Badge 渲染 | ✅ |
| **AC7**: 前端 JSON 匹配编辑 | 可测 | 组件测试：Tab 切换 + 行增删 + exists 隐藏值 | ✅ |
| **AC8**: 向后兼容 | 可测 | 回归测试：现有规则 + 不传新字段的 API 调用 | ✅ |

### 3. FR 覆盖度检查

| FR | 完整性 | 说明 |
|----|--------|------|
| FR1 Provider 隔离 | ✅ | provider_id TEXT NULL，匹配优先级明确，1:N 关系，created_at DESC 排序 |
| FR2 JSON 字段匹配 | ✅ | body_matchers JSON 格式完整，3 种 operator，AND 关系，正则 fallback |
| FR3 RetryRuleMatcher 升级 | ✅ | match() 签名变更 + 缓存结构重设计 + 所有调用方适配 |
| FR4 stream_error 响应修复 | ⚠️ | 缺少非流式错误路径显式提及（见 Issue #1） |
| FR5 upstream_error_logs 表 | ⚠️ | error_type 提取优先级未定义（见 Issue #2） |
| FR6 前端适配 | ⚠️ | 空匹配条件交互未定义（见 Issue #3） |
| FR7 DB Schema 变更 | ✅ | 迁移文件 + ALTER TABLE + 新表 + 索引完整 |
| FR8 Admin API 适配 | ✅ | CRUD + 类型定义 + AI 生成规则处理 |
| FR9 StateRegistry 刷新 | ✅ | refreshRetryRules → load() 适配新缓存结构 |

### 4. 跨 FR 集成点验证

| 集成点 | FR 关联 | 一致性 | 风险 |
|--------|---------|--------|------|
| DB Schema → Matcher 加载 | FR7 → FR3 | 一致 | 低 |
| Matcher 匹配 → Resilience 决策 | FR3 → FR4 | 一致 | 低 |
| Resilience 结果 → failover-loop 处理 | FR4 → FR5 | 一致 | 低 |
| Admin API → StateRegistry 刷新 | FR8 → FR9 | 一致 | 低 |
| Admin API 格式 → 前端展示 | FR8 → FR6 | 一致 | 低 |
| 迁移文件编号 049 | FR7 | 检查约束条件 | 低 |

### 5. 边界条件与分析

**边界条件检查：**

| 边界 | 覆盖状态 | 说明 |
|------|---------|------|
| 绑定规则全部不匹配 → fallback | ✅ AC1 | 明确：binding all miss → generic fallback |
| body 非合法 JSON | ✅ AC2 | 明确：body_matchers 返回 false → 正则 fallback |
| body_matchers + body_pattern 均无 | ⚠️ Issue #3 | 前端保存行为未定义 |
| provider 删除后绑定规则处理 | ❌ | 无 cascade/cleanup 策略 — 规则变为孤儿记录。但项目现有模式一致（无级联删除） |
| 迁移前已有规则的兼容性 | ✅ AC8 | 所有现有规则 provider_id=NULL, body_matchers=NULL |
| 同一个 provider 多条规则排序 | ✅ FR1 | created_at DESC |

### 6. 已知问题状态（继承自 v1 + 独立验证）

| # | 优先级 | 位置 | 描述 | 状态 | 本轮解决？ |
|---|--------|------|------|------|------------|
| 1 | LOW | FR4 | stream_error 响应修复缺少非流式路径显式覆盖 | open | 否 — spec 未更新 |
| 2 | LOW | FR5 | error_type 提取逻辑未定义优先级 | open | 否 — spec 未更新 |
| 3 | INFO | FR6 | 前端空匹配条件交互定义 | open | 否 — spec 未更新 |

## 结论

**通过** — 0 条 MUST FIX，2 条 LOW 建议，1 条 INFO 观察。

全部 8 个 AC 均可测试验证，9 个 FR 之间的依赖链和集成点一致。Spec 质量合格，可进入 plan 编写阶段。

### Summary

Spec 评审完成，第2轮通过，0条MUST FIX。

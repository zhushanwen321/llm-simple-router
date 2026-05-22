---
review:
  type: test_review
  round: 1
  timestamp: "2026-05-22T14:00:00"
  target: "spec.md AC1-AC8 / test_cases_template.json / test_execution.json"
  verdict: fail
  summary: "测试评审完成，第1轮，3条MUST FIX，需修改后重审"

statistics:
  total_issues: 6
  must_fix: 3
  must_fix_resolved: 0
  low: 2
  info: 1

issues:
  - id: 1
    severity: MUST_FIX
    location: "AC4: stream_error 格式化响应无集成测试覆盖"
    title: "stream_error 重试耗尽后格式化 JSON 响应路径无端到端自动测试"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 2
    severity: MUST_FIX
    location: "AC6: 前端 Provider 选择无测试覆盖"
    title: "RetryRules.vue 的 Provider 选择功能无任何前端测试"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 3
    severity: MUST_FIX
    location: "AC7: 前端 JSON 字段匹配编辑无测试覆盖"
    title: "RetryRules.vue 的 JSON 字段匹配编辑功能无任何前端测试"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 4
    severity: LOW
    location: "AC1: created_at DESC 排序未测试"
    title: "多条绑定规则按 created_at DESC 排序的优先级未验证"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 5
    severity: LOW
    location: "AC8: 向后兼容无显式测试"
    title: "无显式测试验证不传新字段创建规则的行为"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 6
    severity: INFO
    location: "test_execution.json: TC-3-02"
    title: "TC-3-02 的通过证据依赖代码审查而非自动化测试"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# 测试评审 v1

## 评审记录
- 评审时间：2026-05-22 14:00
- 评审类型：测试评审
- 评审对象：test_cases_template.json（17 个用例）、test_execution.json（全部通过）、测试源文件 5 个

## AC 覆盖矩阵

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC1 | 绑定规则优先于通用规则 | ✅ | retry-rule-matcher.test.ts: "prefers provider-bound over global" |
| AC1 | 无绑定规则时 fallback 到通用规则 | ✅ | retry-rule-matcher.test.ts: "falls back to global when no provider-specific rule matches" |
| AC1 | 绑定规则不匹配时 fallback 到通用规则 | ✅ | retry-rule-matcher.test.ts: fallback scenario with provider-a rule not matching |
| AC1 | 多条绑定规则按 created_at DESC 排序 | ❌ | 无测试验证 created_at DESC 排序行为 |
| AC2 | equals 操作符精确匹配 | ✅ | body-matcher.test.ts: equals tests |
| AC2 | contains 操作符子串匹配 | ✅ | body-matcher.test.ts: contains tests |
| AC2 | exists 操作符字段存在即匹配 | ✅ | body-matcher.test.ts: exists tests |
| AC2 | AND 逻辑（多条件同时满足） | ✅ | body-matcher.test.ts: AND logic tests (both pass / one fails) |
| AC2 | 非 JSON body 返回 false（fallback 到正则） | ✅ | body-matcher.test.ts: "returns false on invalid JSON"; retry-rule-matcher.test.ts: falls back to body_pattern |
| AC2 | 嵌套路径正确解析 | ✅ | body-matcher.test.ts: resolvePath nested/deeply nested |
| AC3 | 429 usage-limit 不再误触发其他 provider 重试 | ✅ | integration-retry-rules.test.ts: TC-3-01 (bound rule max_retries=0, non-stream) |
| AC4 | stream_error 重试耗尽后客户端收到格式化 JSON 错误 | ⚠️ | resilience.test.ts: decide() stream_error 单元测试覆盖了 retry/abort/failover 决策，但**未端到端验证格式化 JSON 响应体是否正确发送** |
| AC5 | upstream_error_logs 写入 | ✅ | integration-retry-rules.test.ts: TC-5-01 (验证 provider_id, status_code, error_type, error_message, retry_count) |
| AC5 | extractErrorInfo 优先级（type > code > null） | ✅ | extract-error-info.test.ts: TC-6-01 (6 个子场景) |
| AC6 | 前端 Provider 选择（Dialog Select + 表格显示） | ❌ | 无前端测试覆盖 |
| AC7 | 前端 JSON 字段匹配编辑（Tab 切换、增删行、exists 隐藏值） | ❌ | 无前端测试覆盖 |
| AC8 | 向后兼容：现有规则行为不变 | ⚠️ | 隐式覆盖（全局规则测试仍通过），但**无显式测试验证不传 provider_id/body_matchers 创建规则** |

## 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | MUST FIX | AC4: stream_error 格式化响应 | **stream_error 重试耗尽后格式化 JSON 响应路径无端到端自动测试。** resilience.test.ts 仅覆盖了 decide() 的决策路径（retry/abort/failover），但未覆盖： (a) failover-loop.ts 中 adapter.formatError() 调用是否返回正确的 JSON 格式，(b) sendResponse() 是否正确设置 content-type: application/json，(c) client_status_code 是否正确记录。TC-3-02 的通过证据仅依赖"代码审查确认"，非自动化测试验证。 | 新增一个集成测试：mock 上游在 SSE 前返回 429，配置重试规则 max_retries=0（或 no_retry），验证 (1) 客户端收到 JSON 格式错误（非 SSE 格式），(2) Content-Type 为 application/json，(3) request_logs 中 client_status_code = 429。可参考 TC-3-01 的测试模式（buildTestApp + app.inject + mockBackend）。 |
| 2 | MUST FIX | AC6: 前端 Provider 选择 | **RetryRules.vue 的 Provider 选择功能无任何测试覆盖。** spec 明确要求 Dialog 中 Select 组件支持选择 provider 或 "通用"、表格中显示 provider 名称或 "通用" Badge。零测试覆盖意味着该功能不可验证。 | 为 RetryRules.vue 添加组件测试： (a) Dialog 打开后 Provider Select 的默认值为"通用"，(b) 选择 provider 后表格行显示对应名称，(c) 选择"通用"后显示 Badge。 |
| 3 | MUST FIX | AC7: 前端 JSON 字段匹配编辑 | **RetryRules.vue 的 JSON 字段匹配编辑功能无任何测试覆盖。** spec 要求 Tab 切换（正则/JSON）、可增删匹配条件行、exists 操作符隐藏值输入。零测试覆盖。 | 添加组件测试覆盖： (a) 切换到 JSON 匹配 Tab 后显示匹配条件列表，(b) 添加新条件行，(c) exists 操作符选择后值输入框隐藏，(d) 删除条件行，(e) 保存后序列化为正确的 body_matchers JSON。 |
| 4 | LOW | AC1: created_at DESC 排序 | **多条绑定规则的 created_at DESC 排序无测试验证。** spec 明确要求"绑定规则之间按 created_at DESC 排序"，但所有测试仅验证单条规则匹配行为。如果排序实现有误（如 ASC 或无序），匹配优先级会错误。 | 在 retry-rule-matcher.test.ts 中新增测试：创建多条绑定规则（不同 created_at），验证 match() 返回 created_at 最新的规则。 |
| 5 | LOW | AC8: 向后兼容 | **无显式向后兼容测试。** retry-rule-matcher.test.ts 的全局规则测试隐式覆盖了向后兼容，但缺乏显式测试证明： (a) 不传新字段创建规则正常工作，(b) 现有规则数据在新代码下行为不变。Admin API 测试 (TC-4-01) 仅测试了带新字段的创建。 | 在 admin-retry-rules-provider.test.ts 中新增测试：POST 创建规则仅传旧字段（无 provider_id、无 body_matchers），验证 201 成功且返回值为 null。 |
| 6 | INFO | test_execution.json: TC-3-02 | **TC-3-02 的"通过"证据引用代码审查而非自动化测试。** test_execution.json 中 TC-3-02 的 evidence 为 "failover-loop.ts code review confirms adapter.formatError() usage"——这不在自动化测试框架内运行，任何重构都可能打破该行为而不被发现。 | 将 TC-3-02 的验证方式从"代码审查"改为"集成测试"（见 MUST FIX #1 建议），使自动化测试覆盖该路径。 |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程。此处为测试逻辑缺陷（覆盖率不足、漏测场景）。
> - **LOW**：建议修复，但不阻塞。
> - **INFO**：观察记录，无需操作。

## 测试质量评估

### 优点

1. **body-matcher.test.ts 边界覆盖充分**：8 个 resolvePath 测试 + 12 个 matchBodyMatchers 测试，覆盖了所有运算符、AND 逻辑、非 JSON 输入、嵌套/深层路径、null/undefined 输入、空数组、Boolean 值转换。质量高。

2. **retry-rule-matcher.test.ts 结构清晰**：按 provider 隔离、结构化匹配、废弃规则、test() 方法、reload、畸形 JSON 等分 describe 块组织。每个 describe 组针对一个明确的行为维度。

3. **extract-error-info.test.ts 精简完整**：6 个测试覆盖 type 优先 > code fallback > null、非字符串类型、非法 JSON——刚好覆盖 spec 要求的优先级逻辑。

4. **integration-retry-rules.test.ts 测试模式正确**：使用真实 SQLite :memory:、真实 mock backend 服务器、Fastify inject——不做 DB mock，贴近生产。

5. **admin-retry-rules-provider.test.ts 校验完备**：除主功能测试外，增加了 4 个 body_matchers 格式校验测试（无效 JSON、非数组、缺 path、无效 operator），体现了防御性测试思维。

### 问题

1. **前端零测试覆盖**：AC6、AC7 共 2 个 AC 无任何前端测试。虽然项目可能缺少前端测试基础设施，但 spec 中明确的 UI 交互复杂度需要可验证性。

2. **stream_error 响应格式化路径无端到端测试**：TC-3-02 的描述与实际测试内容不匹配——描述为"客户端收到 JSON 错误"，但实际只有 decide() 单元测试覆盖了重试决策，没有验证 HTTP 响应体。

3. **匹配优先级边界未覆盖**：多条绑定规则的 created_at DESC 排序优先级未测试，这是一个潜在的运行时 bug 区域。

## 结论

**需修改后重审**

3 条 MUST FIX 问题，均为测试覆盖缺口：
- AC4 的 stream_error 格式化响应路径缺少集成测试（关键数据流路径）
- AC6、AC7 的前端功能缺少组件测试

## Summary

测试评审完成，第1轮，3条MUST FIX，需修改后重审。

---
review:
  type: test_review
  round: 1
  timestamp: "2026-05-21T16:30:00"
  target: "changes/evidence/test_execution.json"
  verdict: "fail"
  summary: "测试评审完成，第1轮，1条MUST FIX，overflow_redirect 场景未覆盖"

statistics:
  total_issues: 9
  must_fix: 1
  must_fix_resolved: 0
  low: 6
  info: 2

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md AC6.3"
    title: "mapping_reason=overflow_redirect 未覆盖 — 无对应测试用例"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 2
    severity: LOW
    location: "diagnostic-fields.test.ts TC7 (error_code test)"
    title: "error_code 测试使用弱断言（toBeTruthy）而非精确值匹配"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 3
    severity: LOW
    location: "spec.md AC4 / diagnostic-fields.test.ts"
    title: "headers_sent=1 仅通过代码审查验证，无独立断言"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 4
    severity: LOW
    location: "spec.md AC5.3 / diagnostic-fields.test.ts TC10"
    title: "resilience_action spec 要求 IS NULL，测试期望 'done'"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 5
    severity: LOW
    location: "spec.md AC7.1 / diagnostic-fields.test.ts TC13"
    title: "failover_trigger 测试 status_500 而非 ProviderSwitchNeeded"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 6
    severity: LOW
    location: "test_cases_template.json TC-2-02 / TC-2-03"
    title: "client_disconnect 和 loop_detection 不可在 vitest 中执行，仅代码路径验证"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 7
    severity: LOW
    location: "test_cases_template.json TC-4-02 / actual test TC11"
    title: "TC-4-02 模板描述失败前场景，实际测试成功请求，前后不一致"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 8
    severity: INFO
    location: "spec.md AC8.4"
    title: "UI 保存重载场景未测试，仅源码验证"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 9
    severity: INFO
    location: "diagnostic-fields.test.ts TC9"
    title: "mapping_reason 使用正则匹配而非精确枚举值断言"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# 测试评审 v1

## 评审记录
- 评审时间：2026-05-21 16:30
- 评审类型：测试评审
- 评审对象：`changes/evidence/test_execution.json` — diagnostic-fields.test.ts (13 tests) + mapping-reason-failover.test.ts (2 tests)

## 评审说明

本评审以 spec.md 定义的 8 项验收标准（AC1-AC8）为依据，逐条检查测试覆盖度、测试质量、可维护性和数据构造合理性。审阅材料包括：

- **spec.md** — 8 项 AC，每项含多个场景
- **e2e-test-plan.md** — 7 个测试场景组
- **test_cases_template.json** — 25 个测试用例模板
- **test_execution.json** — 所有 25 个 TCs 的执行证据
- **test_results.md** — 汇总结果（13 项 vitest 断言 + 3 项前端源码验证）
- **diagnostic-fields.test.ts** — 13 个 it() 的完整测试代码
- **mapping-reason-failover.test.ts** — 2 个 it() 的完整测试代码

## AC 覆盖矩阵

### AC1: transport_kind 写入验证 — ✅ 完整覆盖

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC1.1 | 非流式 200 → `success` | ✅ | diagnostic-fields.test.ts TC1 |
| AC1.2 | 流式 SSE 200 → `stream_success` | ✅ | diagnostic-fields.test.ts TC2 |
| AC1.3 | 上游 500 (非流式) → `error` | ✅ | diagnostic-fields.test.ts TC3 |
| AC1.4 | 流式 500 → `stream_error` | ✅ | diagnostic-fields.test.ts TC12 |
| AC1.5 | 连接拒绝 → `throw` | ✅ | diagnostic-fields.test.ts TC4 |
| AC1.6 | 流式超时 → `stream_abort` | ✅ | diagnostic-fields.test.ts TC5 (timeout 触发 abort) |

### AC2: abort_reason 写入验证 — ⚠️ 部分覆盖

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC2.1 | idle timeout → `idle_timeout` | ✅ | diagnostic-fields.test.ts TC5 |
| AC2.2 | 客户端断连 → `client_disconnect` | ⚠️ | stream.ts:209 代码路径确认，vitest 不可执行 |
| AC2.3 | 循环检测 → `loop_detection` | ⚠️ | stream.ts:281-282 代码路径确认，由现有 loop-prevention 测试覆盖 |
| AC2.4 | 非 abort → NULL | ✅ | diagnostic-fields.test.ts TC6 |

### AC3: error_code 写入验证 — ⚠️ 部分覆盖

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC3.1 | 连接错误 → error_code 非空 | ⚠️ | diagnostic-fields.test.ts TC7 — 测试 ECONNREFUSED 而非 ETIMEDOUT，断言仅为 toBeTruthy |
| AC3.2 | 正常成功 → NULL | ✅ | diagnostic-fields.test.ts TC8 |

### AC4: headers_sent 写入验证 — ⚠️ 部分覆盖

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC4.1 | 流式 headers 已发后出错 → 1 | ⚠️ | resilience.ts 代码审查验证，TC12 执行路径但无 headers_sent 断言 |
| AC4.2 | headers 发送前失败 → 0/NULL | ⚠️ | TC7(连接拒绝) 执行路径但无 headers_sent 断言 |
| AC4.3 | 非流式成功 → NULL | ✅ | diagnostic-fields.test.ts TC11 |

### AC5: resilience decision 写入验证 — ⚠️ 部分覆盖

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC5.1 | 重试 → `retry` + reason 非空 | ✅ | 现有 resilience.test.ts 覆盖 |
| AC5.2 | failover → `failover` | ✅ | diagnostic-fields.test.ts TC13 |
| AC5.3 | 无需重试 → NULL | ⚠️ | diagnostic-fields.test.ts TC10 — 测试期望 "done"，但 spec 要求 NULL |

### AC6: mapping_reason 写入验证 — ❌ 未覆盖 (overflow_redirect)

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC6.1 | 直接格式 → `direct_format` | ⚠️ | 现有 mapping-resolver 测试覆盖 reason 逻辑 |
| AC6.2 | 映射组基础规则 → `group_base_rule` | ✅ | diagnostic-fields.test.ts TC9 — mapping_reason 非空 |
| AC6.3 | 溢出重定向 → `overflow_redirect` | ❌ | **无对应测试用例** |
| AC6.4 | failover 重试 → `failover_retry` | ✅ | mapping-reason-failover.test.ts |

### AC7: failover_trigger 写入验证 — ⚠️ 部分覆盖

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC7.1 | ProviderSwitchNeeded → 非空 | ⚠️ | diagnostic-fields.test.ts TC13 — status_500 路径，非 ProviderSwitchNeeded |
| AC7.2 | 正常请求 → NULL | ✅ | diagnostic-fields.test.ts TC13 |

### AC8: 模型超时 UI 修复验证 — ⚠️ 部分覆盖

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC8.1 | Provider 编辑页未配置 → 空输入框 | ✅ | ModelCard.vue 源码验证 (v-if 已移除) |
| AC8.2 | 快速配置页未配置 → 空输入框 | ✅ | ModelCapabilitiesEditor.vue 源码验证 |
| AC8.3 | 已配置 → 显示秒数 | ✅ | ModelCard.vue 源码验证 (:model-value) |
| AC8.4 | 保存重载后正确显示 | ⚠️ | 无实际保存重载测试，仅源码验证 |

### 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | **MUST FIX** | spec.md AC6.3 / e2e-test-plan.md TS5 | **overflow_redirect 映射原因无测试覆盖。** e2e-test-plan.md 明确列出"溢出重定向→overflow_redirect"场景，但 test_cases_template.json 和 test_execution.json 中均无对应的 TC。这意味着溢出重定向路径的 mapping_reason 写入完全未经测试验证。 | 新增一个溢出重定向测试：配置一个 context_window 较小的模型，发送超长请求触发 overflow_redirect，断言 request_logs.mapping_reason = "overflow_redirect"。或若溢出逻辑由 overflow.ts 独立处理，可在现有 overflow.test.ts 中扩展断言。 |
| 2 | LOW | diagnostic-fields.test.ts TC7 (error_code) | **error_code 断言使用 toBeTruthy + typeof 而非精确值匹配。** AC3 明确要求 `error_code = "ETIMEDOUT"`，但测试仅验证 error_code 非空且为 string，不验证具体值。且测试场景为 ECONNREFUSED 而非 ETIMEDOUT。 | 将断言改为 `expect(row!.error_code).toBe("ECONNREFUSED")`，或同时添加 ETIMEDOUT 场景（需 mock 连接超时）。 |
| 3 | LOW | diagnostic-fields.test.ts / evidence TC-4-01 | **headers_sent=1 场景依赖代码审查而非测试断言。** AC4.1 要求"流式传输 headers 已发后出错→headers_sent=1"，但 TC12 仅断言 transport_kind="stream_error"，未断言 headers_sent=1。证据中标注"代码路径验证"是不够的。 | 在 TC12 (stream_error) 中增加断言：`expect(row!.headers_sent).toBe(1)`，确保 headers_sent 列在 stream_error 场景下正确填充。 |
| 4 | LOW | spec.md AC5.3 / diagnostic-fields.test.ts TC10 | **resilience_action spec 要求 IS NULL，测试期望 "done"。** AC5.3 规定"无需重试成功→resilience_action IS NULL"，但 TC10 断言 `resilience_action === "done"`。这可能是实现阶段变更了设计（用 "done" 替代 NULL 更明确），但 spec 未同步更新。 | 同步更新 spec.md AC5.3 中的期望值，从 `IS NULL` 改为 `"done"`，保持文档与实现一致。 |
| 5 | LOW | diagnostic-fields.test.ts TC13 / spec.md AC7.1 | **failover_trigger 测试仅验证 status_500 路径，未测试 ProviderSwitchNeeded。** AC7.1 明确要求"触发 ProviderSwitchNeeded→failover_trigger=ProviderSwitchNeeded"，但 TC13 通过 status_500 触发外层 failover 路径，结果为 failover_trigger="status_500"。ProviderSwitchNeeded 内部路径虽标注为"被覆盖"，但无独立断言。 | 新增一个 TC 模拟 ProviderSwitchNeeded 内部路径（如 mapping group 内部 provider 切换），断言 `failover_trigger = "ProviderSwitchNeeded"`。 |
| 6 | LOW | test_cases_template.json TC-2-02 / TC-2-03 | **client_disconnect 和 loop_detection 两项 AC 场景无法在 vitest 中可执行验证。** TC-2-02 需要真实 socket abort 模拟（vitest 环境不可行），TC-2-03 依赖现有 loop-prevention 测试但不确定是否断言 abort_reason DB 列。两者均为代码路径审查而非实际测试执行。 | 1) 为 client_disconnect 考虑创建集成测试环境（真实 socket）；2) 确认现有 loop_detection 测试已断言 abort_reason 列，否则补充断言。 |
| 7 | LOW | test_cases_template.json TC-4-02 / diagnostic-fields.test.ts TC11 | **TC-4-02 模板与实现不匹配。** 模板描述"Request that fails before headers sent"但实际测试 TC11 为"normal non-throw success"（headers_sent=NULL for success）。模板反映了 AC4.2（失败前场景）但实现覆盖的是 AC4.3（成功场景）。AC4.2 实际未测试。 | 根据实际情况：若 AC4.2 被认为等价于 AC4.3（失败前 headers 未发送故为 NULL，与成功一致），更新模板描述；否则新增一个真实失败前场景的测试（如 TC7 连接拒绝后断言 headers_sent）。 |
| 8 | INFO | spec.md AC8.4 | **UI 保存重载场景仅源码验证。** AC8.4"输入超时值后保存，重新加载后显示正确"是 e2e 行为，当前仅通过代码审查验证 ModelCard.vue 的 v-if 移除和 :model-value 绑定，未运行实际的保存→重载流程。在当前无 Playwright 环境下可接受。 | 后续引入 Playwright 或 Cypress 后可补充此场景的 e2e 测试。当前无需修复。 |
| 9 | INFO | diagnostic-fields.test.ts TC9 | **mapping_reason 断言使用正则而非精确枚举匹配。** TC9 验证 mapping_reason 匹配 `^(direct_format\|group_base_rule\|fallback_provider\|group_schedule)$`，没有包含 failover_retry 和 overflow_redirect。正则排除了 overflow_redirect 等有效枚举值，会在新增枚举时失效。 | 考虑将映射原因枚举值抽为常量，使用 `expect(VALID_REASONS).toContain(row!.mapping_reason)` 替代正则匹配。当前非阻塞。 |

## 测试质量评估

### 断言充分性

整体断言质量良好。13 个 vitest 测试覆盖了主要的成功/失败路径，每个测试都验证了具体的 DB 列值。不足在于：

- **error_code** (TC7) 使用 `toBeTruthy` 而非精确值 → 降低断言精度
- **headers_sent** (TC12) 未对 stream_error 路径断言 → 遗漏关键验证点
- **TC13** failover_trigger 使用 `.filter().length` 间接验证，不对单一日志断言精确值

### 测试结构

- **Arrange-Act-Assert** 模式清晰，每个测试包含完整的 mock backend 设置、请求发送、DB 查询、断言
- 使用 `buildTestApp()` + 内存 SQLite + mock HTTP server — 符合项目测试规范
- 每个测试独立（beforeEach 创建 DB，afterEach 关闭），无执行顺序依赖
- **Setup 代码重复**：多个测试重复了相同的 `insertMockBackend`、`insertModelMapping`、`buildTestApp`、`createMockBackend` 模式。TC1/2/3/6/8/9/10/11 几乎是同一套模板。建议提取公共 helper 减少约 50% 的模板代码。

### 数据构造合理性

- 测试数据贴近真实场景：使用标准 OpenAI 响应格式、真实 SSE 分块、真实 HTTP 状态码
- **getDeadPort()** 技术巧妙 — 创建真实端口后立即关闭，模拟 ECONNREFUSED
- **TC5 (timeout)** 使用 500ms 超时 + 5000ms 后端延迟，5s 超时上限确保测试不挂起，设计合理
- mapping-reason-failover.test.ts 使用 `pipeline_snapshot` JSON 断言而非直接查询 `mapping_reason` 列 — 验证明细路径而非最终 DB 列

## 结论

需修改后重审

## Summary

测试评审完成，第1轮，1条 MUST FIX（AC6.3 overflow_redirect 未覆盖），需补充溢出重定向场景测试后重审。其余 6 条 LOW（弱断言、代码审查替代测试、spec-测试不一致、不可执行场景）和 2 条 INFO（无 Playwright 环境限制、正则匹配泛化）。

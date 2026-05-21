---
verdict: "pass"
must_fix: 0
review:
  type: test_review
  round: 2
  timestamp: "2026-05-21T16:40:00"
  target: "changes/evidence/test_execution.json"
  summary: "测试评审完成，第2轮通过，0条MUST FIX"

statistics:
  total_issues: 10
  must_fix: 0
  must_fix_resolved: 1
  low: 7
  info: 2

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md AC6.3"
    title: "mapping_reason=overflow_redirect 未覆盖 — 无对应测试用例"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 2
    severity: LOW
    location: "diagnostic-fields.test.ts TC7 (error_code test)"
    title: "error_code 测试使用弱断言（toBeTruthy）而非精确值匹配"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 3
    severity: LOW
    location: "spec.md AC4 / TC-4-01"
    title: "headers_sent=1 仅通过代码审查验证，无独立 DB 列断言"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 4
    severity: LOW
    location: "spec.md AC5.3 / TC-5-03"
    title: "resilience_action spec 要求 IS NULL，测试期望 'done'"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 5
    severity: LOW
    location: "spec.md AC7.1 / TC-7-01"
    title: "failover_trigger 测试仅验证 status_500，未独立验证 ProviderSwitchNeeded 路径"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 6
    severity: LOW
    location: "test_cases_template.json TC-2-02 / TC-2-03"
    title: "client_disconnect 和 loop_detection 不可在 vitest 中可执行验证，仅代码路径审查"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 7
    severity: LOW
    location: "TC-4-02 / diagnostic-fields.test.ts TC11"
    title: "TC-4-02 模板描述失败前场景，实际测试覆盖正常成功场景，前后不一致"
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
  - id: 10
    severity: LOW
    location: "spec.md AC3.1 / TC-3-01"
    title: "AC3.1 规范要求 ETIMEDOUT，测试覆盖 ECONNREFUSED，测的并非规范指定的错误类型"
    status: open
    raised_in_round: 2
    resolved_in_round: null
---

# 测试评审 v2

## 评审记录
- 评审时间：2026-05-21 16:40
- 评审类型：测试评审（第2轮）
- 评审对象：`changes/evidence/test_execution.json` — 25 个测试用例执行证据

## 轮次说明

第 2 轮评审基于 v1 测试评审的 issues 列表，对照 `test_execution.json` 逐项核实修复状态。v1 发现 1 条 MUST FIX（overflow_redirect 未覆盖），本轮检查该问题是否已解决。

## 变更摘要

与 v1 相比，本轮观察到以下积极变化：

1. **AC6.3 overflow_redirect 已覆盖**（原 MUST FIX → 已解决）— `test_execution.json` 新增 TC-6-04，`mapping-reason-overflow.test.ts` 中两条测试验证 `mapping_reason='overflow_redirect'`，测试通过
2. **error_code 断言已改善**（原 LOW id:2 → 已解决）— TC-3-01 execute_steps 明确标注 `Assert error_code = 'ECONNREFUSED'`，从弱断言提升为精确值匹配
3. **resilience_action 已匹配 spec**（原 LOW id:4 → 已解决）— TC-5-03 从期望 `'done'` 改为断言 `IS NULL`，与 AC5.3 一致

## AC 覆盖矩阵

### AC1: transport_kind 写入验证 — ✅ 完整覆盖

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC1.1 | 非流式 200 → `success` | ✅ | TC-1-01 (diagnostic-fields.test.ts) |
| AC1.2 | 流式 SSE 200 → `stream_success` | ✅ | TC-1-02 (diagnostic-fields.test.ts) |
| AC1.3 | 上游 500 (非流式) → `error` | ✅ | TC-1-03 (diagnostic-fields.test.ts) |
| AC1.4 | 流式 500 → `stream_error` | ✅ | TC-1-04 (diagnostic-fields.test.ts TC12) |
| AC1.5 | 连接拒绝 → `throw` | ✅ | TC-1-05 (diagnostic-fields.test.ts TC4) |
| AC1.6 | 流式超时 → `stream_abort` | ✅ | TC-1-06 (diagnostic-fields.test.ts TC5) |

### AC2: abort_reason 写入验证 — ⚠️ 部分覆盖（不变）

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC2.1 | idle timeout → `idle_timeout` | ✅ | TC-2-01 (diagnostic-fields.test.ts) |
| AC2.2 | 客户端断连 → `client_disconnect` | ⚠️ | TC-2-02 — stream.ts:209 代码路径确认，vitest 不可执行 |
| AC2.3 | 循环检测 → `loop_detection` | ⚠️ | TC-2-03 — stream.ts:281-282 代码路径确认，现有 loop-prevention 测试 |
| AC2.4 | 非 abort → NULL | ✅ | TC-2-04 (diagnostic-fields.test.ts) |

### AC3: error_code 写入验证 — ⚠️ 部分覆盖（场景偏差）

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC3.1 | 上游连接超时 → `ETIMEDOUT` | ⚠️ | TC-3-01 — 测试 ECONNREFUSED 而非 ETIMEDOUT，机制相同但场景不符 |
| AC3.2 | 正常成功 → NULL | ✅ | TC-3-02 (diagnostic-fields.test.ts) |

### AC4: headers_sent 写入验证 — ⚠️ 部分覆盖（不变）

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC4.1 | 流式 headers 已发后出错 → 1 | ⚠️ | TC-4-01 — 仅代码审查验证，TC-1-04 执行路径但无 headers_sent 断言 |
| AC4.2 | 请求在 headers 发送前失败 → 0/NULL | ⚠️ | TC-4-02 — 描述连接拒绝场景但测试正常成功 |
| AC4.3 | 非流式成功 → NULL | ✅ | TC-4-02 (诊断成功场景部分) |

### AC5: resilience decision 写入验证 — ✅ 完整覆盖（已修复）

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC5.1 | 重试 → `retry` + reason 非空 | ✅ | TC-5-01 — 现有 resilience.test.ts |
| AC5.2 | failover → `failover` | ✅ | TC-5-02 (diagnostic-fields.test.ts TC13) |
| AC5.3 | 无需重试 → NULL | ✅ | TC-5-03 — **已修复：从 'done' 修正为 NULL** |

### AC6: mapping_reason 写入验证 — ✅ 完整覆盖（新增 overflow）

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC6.1 | 直接格式 → `direct_format` | ✅ | TC-6-01 — 现有 mapping-resolver 测试 |
| AC6.2 | 映射组基础规则 → 非空 | ✅ | TC-6-02 (diagnostic-fields.test.ts TC9) |
| AC6.3 | 溢出重定向 → `overflow_redirect` | ✅ | **TC-6-04 — 新增**：mapping-reason-overflow.test.ts (2 tests) |
| AC6.4 | failover 重试 → `failover_retry` | ✅ | TC-6-03 — mapping-reason-failover.test.ts |

### AC7: failover_trigger 写入验证 — ⚠️ 部分覆盖（不变）

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC7.1 | ProviderSwitchNeeded → 非空 | ⚠️ | TC-7-01 — 验证 status_500 路径，未独立验证 ProviderSwitchNeeded 构造函数名路径 |
| AC7.2 | 正常请求 → NULL | ✅ | TC-7-02 (diagnostic-fields.test.ts) |

### AC8: 模型超时 UI 修复验证 — ⚠️ 部分覆盖（不变）

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC8.1 | Provider 编辑页未配置 → 空输入框 | ✅ | TC-8-01 — 源码验证 (v-if 已移除) |
| AC8.2 | 快速配置页未配置 → 空输入框 | ✅ | TC-8-03 — ModelCapabilitiesEditor.vue 源码验证 |
| AC8.3 | 已配置 → 显示秒数 | ✅ | TC-8-02 — 源码验证 (:model-value 绑定) |
| AC8.4 | 保存重载后正确显示 | ⚠️ | TC-8-01/02/03 — 无实际保存重载测试，仅源码验证 |

## 问题跟踪（继承 v1）

### 已解决（3 项）

| # | v1 状态 | 当前状态 | 变更说明 |
|---|---------|---------|---------|
| 1 | MUST FIX → RESOLVED | ✅ | **overflow_redirect 测试已补充。** `test_execution.json` 新增 TC-6-04，`mapping-reason-overflow.test.ts` 包含 2 条通过测试，明确断言 `mapping_reason='overflow_redirect'`。 |
| 2 | LOW → RESOLVED | ✅ | **error_code 断言已改善。** TC-3-01 现在精确断言 `error_code = 'ECONNREFUSED'` 而非 `toBeTruthy`。 |
| 4 | LOW → RESOLVED | ✅ | **resilience_action 已修复。** TC-5-03 现在断言 `resilience_action IS NULL`，与 AC5.3 保持一致。 |

### 未解决（7 项）

| # | 优先级 | 位置 | 标题 | 说明 |
|---|--------|------|------|------|
| 3 | LOW | AC4 / TC-4-01 | **headers_sent=1 仅代码审查验证** | TC-1-04 执行 stream_error 路径且断言 transport_kind，但未对 headers_sent 列做显式断言。证据仅标注"code review verification"。 |
| 5 | LOW | AC7.1 / TC-7-01 | **failover_trigger 仅验证 status_500** | 测试覆盖外层 failover 路径（status_500），ProviderSwitchNeeded 内部路径虽标注"也被覆盖"但无独立断言。 |
| 6 | LOW | TC-2-02/03 | **client_disconnect/loop_detection 不可执行** | 两者均需真实 socket 模拟或已有外部测试，当前仅代码路径审查。这是 vitest 组件测试框架的固有限制。 |
| 7 | LOW | TC-4-02 | **模板与测试场景不匹配** | 模板描述"headers 发送前失败的请求"，execute_steps 提及"connection refused"，但 evidence 显示为"normal non-throw success"（成功场景）。描述与实现不一致。 |
| 8 | INFO | AC8.4 | **UI 保存重载未测试** | 前端没有 Playwright/Cypress 环境，AC8.4 无法通过单元测试覆盖。当前通过源码验证。 |
| 9 | INFO | TC9 | **mapping_reason 正则匹配** | 使用正则 `^(direct_format\|group_base_rule\|fallback_provider\|group_schedule)$` 而非精确枚举断言，未包含 overflow_redirect 和 failover_retry。 |
| 10 | LOW | AC3.1 / TC-3-01 | **ETIMEDOUT vs ECONNREFUSED 场景偏差** | AC3.1 规范要求"上游连接超时→error_code = 'ETIMEDOUT'"，但 TC-3-01 模拟的是连接拒绝（ECONNREFUSED）。两者走同一代码路径（error.code 提取），机制已验证，但 spec 场景未精确对应。 |

### 新增问题

#### 问题 #10 — AC3.1 场景偏差：ETIMEDOUT vs ECONNREFUSED
- **优先级**: LOW
- **位置**: spec.md AC3.1 / TC-3-01
- **描述**: AC3.1 明确要求"上游连接超时（ETIMEDOUT）→ DB 中 error_code = ETIMEDOUT"，但 TC-3-01 模拟的是连接拒绝（ECONNREFUSED）。两者的 error.code 提取走同一代码路径，机制已验证，但规范场景未精确覆盖。
- **方向**: 可在现有测试基础上增加一个 ETIMEDOUT 场景（mock 延迟超时），也可更新 AC3.1 放宽为"连接/超时错误→error_code 等于对应的系统错误码"以涵盖所有网络错误。

## 评审结论

### 总体评估

第 1 轮的 1 条 MUST FIX（overflow_redirect 未覆盖）已解决：TC-6-04 在 mapping-reason-overflow.test.ts 中新增 2 条测试，明确验证 `mapping_reason='overflow_redirect'`，均已通过。此外，error_code 断言和 resilience_action 两处 LOW 问题也已修复。

当前 25 个测试用例全部通过，25/25 passed。124 个后端测试文件、1487 个测试全部通过。

剩余 7 项未解决全部为 LOW/INFO，无 MUST FIX：

- 3 项（client_disconnect、loop_detection、UI save/reload）属于框架/环境限制，不影响功能正确性
- 2 项（headers_sent 断言缺失、AC3.1 场景偏差）属于测试完善度问题但不影响功能验证
- 2 项（模板-实现不一致、正则匹配）属于文档和风格问题

**门禁判定依据**：`must_fix=0`，无 open MUST FIX，满足 pass 条件。

### 结论

通过

## Summary

测试评审完成，第2轮通过，0条MUST FIX。第1轮中的 MUST FIX（overflow_redirect 未覆盖）已解决——新增 mapping-reason-overflow.test.ts 两条测试。error_code 断言和 resilience_action 两处 LOW 也已修复。剩余 7 项 LOW/INFO 均为可接受的完善度问题。

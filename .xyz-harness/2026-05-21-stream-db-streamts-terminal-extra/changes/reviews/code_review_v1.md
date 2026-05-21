---
review:
  type: code_review
  round: 1
  timestamp: "2026-05-21T16:00:00"
  target: "router/src/proxy/* + router/src/db/* + router/src/core/types.ts + frontend ModelCard.vue + tests"
  verdict: fail
  summary: "编码评审第1轮，3条MUST FIX：headers_sent未覆盖stream_error、stream_error无测试、failover路径无测试"

statistics:
  total_issues: 8
  must_fix: 3
  must_fix_resolved: 0
  low: 4
  info: 1

issues:
  - id: 1
    severity: MUST_FIX
    location: "router/src/proxy/orchestration/resilience.ts:L261-268"
    title: "headers_sent 未为 stream_error 类型 attempt 填充"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 2
    severity: MUST_FIX
    location: "router/tests/diagnostic-fields.test.ts"
    title: "无 transport_kind='stream_error' 测试（AC1 缺口）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 3
    severity: MUST_FIX
    location: "router/tests/diagnostic-fields.test.ts"
    title: "无 ProviderSwitchNeeded failover 路径测试（AC5+AC7 缺口）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 4
    severity: LOW
    location: "router/tests/diagnostic-fields.test.ts:TC10"
    title: "测试名称与断言矛盾：名称声称 NULL 但断言 'done'"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 5
    severity: LOW
    location: "router/src/proxy/handler/failover-loop.ts:L438"
    title: "resilienceReason 提取使用 'reason' in + as cast，类型不安全"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 6
    severity: LOW
    location: "router/src/proxy/proxy-logging.ts:L102"
    title: "abort_reason 依赖最终 result 而非 per-attempt 数据（潜在正确性问题）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 7
    severity: LOW
    location: "router/tests/diagnostic-fields.test.ts:TC10"
    title: "resilience_action='done' 偏离 spec AC5（spec 要求 NULL）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 8
    severity: INFO
    location: "router/tests/diagnostic-fields.test.ts"
    title: "client_disconnect / loop_detection abort_reason 无测试（触发难度高）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# 编码评审 v1

## 评审记录
- 评审时间：2026-05-21 16:00
- 评审类型：编码评审
- 评审对象：ccad92a..HEAD 全部变更（13 files, +757 -17）

## 逐项审查

### 1. Spec 合规（FR1-FR8 对照）

| FR | 要求 | 实现状态 | 问题 |
|----|------|---------|------|
| FR1 transport_kind | 6 种 kind 写入 DB | ✅ `diagnosticFields.transport_kind = attempt.resultKind` | — |
| FR2 abort_reason | 3 种触发原因写入 DB | ✅ stream.ts 三条路径传入 abortReason | Issue #6 |
| FR3 error_code | error.code 写入 DB | ✅ throw 路径提取 `(throwErr as NodeJS.ErrnoException).code` | — |
| FR4 headers_sent | headersSent 写入 DB | ⚠️ 仅 throw 路径填充，stream_error 未覆盖 | **Issue #1** |
| FR5 resilience decision | action+reason 写入 DB | ✅ finalDecision 提取 action/reason | Issue #5 |
| FR6 mapping_reason | 映射原因写入 DB | ✅ effectiveMappingReason 传递 | — |
| FR7 failover_trigger | 错误类型名写入 DB | ✅ e.constructor.name | — |
| FR8 ModelCard UI | 移除 v-if 条件 | ✅ 干净移除 | — |

### 2. 数据流路径验证

#### DB 写入路径（完整）
- `rawInsertRequestLog` SQL 扩展 8 列 ✅
- `RequestLogInsert` 接口扩展 8 字段 ✅
- `RequestLogParams`（log-helpers.ts）扩展 8 字段 ✅
- `logResilienceResult` 4 个 insert 路径均展开 `...diagnosticFields` ✅
- `insertSuccessLog` 传递新字段到 `insertRequestLog` ✅

#### 消费者验证（spec Data Consumer Checklist）
- SSE 实时监控：spec 明确 Out of Scope ✅
- Admin API 查询：spec 明确 Out of Scope，`SELECT *` 自动覆盖 ✅
- 前端展示：spec 明确 Out of Scope ✅

### 3. 类型安全

- `TransportResult.stream_abort` 新增 `abortReason` 联合字面量类型 ✅
- `ResilienceAttempt` 新增 `error_code`/`headers_sent` 可选字段 ✅
- `headers_sent` 类型转换：`boolean | null` → `number | null`（0/1）在 diagnosticFields 中正确处理 ✅
- `ResilienceDecision` 是 discriminated union，`failover-loop.ts` 使用 `"reason" in` + `as` 提取 reason ⚠️ Issue #5

### 4. 架构合规

- 分层正确：transport → orchestration → handler → logging → DB ✅
- 无跨层调用 ✅
- Migration 编号 048 连续（上一版 047） ✅
- 新列均为 `TEXT`/`INTEGER` nullable，无数据迁移负担 ✅
- `RequestLogInsert` 用可选字段扩展，向后兼容 ✅

### 5. 安全和性能

- `e.constructor.name` 用于 failover_trigger：Node.js 后端无 minification 风险 ✅
- 无 SQL 注入风险（prepared statement + 参数绑定） ✅
- 8 个新列均为 nullable，不影响现有 SELECT * 性能 ✅

### 6. `...diagnosticFields` 展开一致性

`proxy-logging.ts` 中 4 个 `insertRequestLog`/`insertSuccessLog` 调用路径全部展开 `...diagnosticFields`：
1. stream_error + 200（L135） ✅
2. throw（L153） ✅
3. error + 非 200（L169） ✅
4. success（L190，通过 `insertSuccessLog`） ✅

### 7. abort_reason 三种触发路径

| 触发原因 | stream.ts 位置 | 代码 | 正确性 |
|---------|--------------|------|--------|
| idle_timeout | setTimeout callback（L159） | `abortReason: "idle_timeout" as const` | ✅ |
| client_disconnect | writeHead catch（L178） | `abortReason: "client_disconnect" as const` | ✅ |
| client_disconnect | close handler（L209） | `abortReason: "client_disconnect" as const` | ✅ |
| loop_detection | loopGuard（L282） | `abortReason: "loop_detection" as const` | ✅ |

注意：loop_detection 路径移除了 `return`，但 `handleChunk` 方法在 `if` 块后无更多代码，不会造成问题。

### 8. eslint-disable 检查

新增代码无 `eslint-disable` 注释 ✅。failover-loop.ts 和 stream.ts 中已有的 `eslint-disable-line taste/no-silent-catch` 是历史代码，非本次变更引入。

### 9. 测试 AC 覆盖矩阵

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC1 transport_kind=success | 非流式 200 | ✅ | TC1 |
| AC1 transport_kind=stream_success | 流式 SSE 200 | ✅ | TC2 |
| AC1 transport_kind=error | 上游 500 | ✅ | TC3 |
| AC1 transport_kind=throw | 连接拒绝 | ✅ | TC4 |
| AC1 transport_kind=stream_error | 流式上游错误 | ❌ | 无 |
| AC1 transport_kind=stream_abort | 隐含在 TC5 | ⚠️ | TC5（未断言 transport_kind） |
| AC2 abort_reason=idle_timeout | 超时触发 | ✅ | TC5 |
| AC2 abort_reason=client_disconnect | 客户端断连 | ❌ | 无（触发难度高） |
| AC2 abort_reason=loop_detection | 循环检测 | ❌ | 无（触发难度高） |
| AC2 abort_reason=NULL | 非 abort 请求 | ✅ | TC6 |
| AC3 error_code=网络错误 | 连接拒绝 | ✅ | TC7 |
| AC3 error_code=NULL | 正常成功 | ✅ | TC8 |
| AC4 headers_sent=1 | headers 发后出错 | ❌ | 无 |
| AC4 headers_sent=0/NULL | headers 前/正常请求 | ✅ | TC11 |
| AC5 resilience_action=retry | 触发重试 | ❌ | 无 |
| AC5 resilience_action=failover | 触发 failover | ❌ | 无 |
| AC5 resilience_action=NULL(或done) | 无重试成功 | ⚠️ | TC10（存 "done" 非 NULL） |
| AC6 mapping_reason=具体值 | 直接匹配 | ⚠️ | TC9（仅验证非 null） |
| AC7 failover_trigger=ProviderSwitchNeeded | 触发 failover | ❌ | 无 |
| AC7 failover_trigger=NULL | 正常请求 | ⚠️ | 隐含但未断言 |
| AC8 ModelCard UI | 移除 v-if | ✅ | 代码变更验证 |

---

## 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | MUST FIX | resilience.ts:L261-268 | **headers_sent 未为 stream_error attempt 填充**。`else` 分支（非 throw，包括 stream_error/error/success 等）不设置 `error_code` 和 `headers_sent`。但 `stream_error` 变体的 `TransportResult` 有 `headersSent?: boolean` 字段。当 stream_error 在 headers 已发送后发生时，`headers_sent` 应为 `1` 而非 `NULL`。违反 AC4："流式传输 headers 已发后出错 → headers_sent = 1"。 | 在 `else` 分支中也提取 `headers_sent`：当 `transportResult.kind === "stream_error"` 时填充 `headers_sent: transportResult.headersSent ?? null`，其他 kind 保持 undefined。或统一为所有非 throw kind 填充 `headers_sent`。 |
| 2 | MUST FIX | diagnostic-fields.test.ts | **无 transport_kind='stream_error' 测试**。AC1 明确要求"上游流式返回错误状态码（如 500）→ transport_kind = 'stream_error'"。当前 11 个测试覆盖了 success/stream_success/error/throw 四种 kind，缺少 stream_error 和 stream_abort（显式断言）的验证。 | 添加测试：mock backend 对流式请求返回非 200 状态码 + SSE 错误响应，断言 `transport_kind = "stream_error"`。 |
| 3 | MUST FIX | diagnostic-fields.test.ts | **无 ProviderSwitchNeeded failover 路径测试**。failover-loop.ts 的第二个 `logResilienceResult` 调用点（ProviderSwitchNeeded catch 块）中的 `resilienceAction="failover"`、`resilienceReason="provider_switch_needed"`、`failoverTrigger=e.constructor.name` 完全未被测试。这是 AC5（failover action）和 AC7（failover_trigger）的核心验证场景。 | 添加 failover 场景测试：配置 mapping_group 多个 target + mock 第一个 target 返回错误 + 重试规则触发 failover，断言 `failover_trigger = "ProviderSwitchNeeded"` 和 `resilience_action = "failover"`。 |
| 4 | LOW | diagnostic-fields.test.ts:TC10 | **测试名称与断言矛盾**。名称 `"should set resilience_action=NULL for normal success without retry"` 声称期望 NULL，但断言 `expect(row!.resilience_action).toBe("done")` 期望 "done"。 | 修正测试名称为 `"should set resilience_action='done' for normal success without retry"` 以匹配实际行为。 |
| 5 | LOW | failover-loop.ts:L438 | **resilienceReason 提取类型不安全**。使用 `"reason" in (resilienceResult.finalDecision ?? {})` + `as { action: string; reason: string }` cast。`ResilienceDecision` 是 discriminated union，只有 `{ action: "abort"; reason: string }` 有 reason 字段。 | 使用 discriminated union narrowing：`resilienceResult.finalDecision?.action === "abort" ? resilienceResult.finalDecision.reason : null`。 |
| 6 | LOW | proxy-logging.ts:L102 | **abort_reason 依赖最终 result 而非 per-attempt 数据**。`diagnosticFields.abort_reason` 检查 `result.kind === "stream_abort"`（最终结果），若某 attempt 是 stream_abort 但被重试后最终成功，该 attempt 的 abort_reason 会错误地为 NULL。当前实践中 stream_abort 极少被重试（headers 已发），但代码逻辑存在潜在正确性问题。 | 若需严格正确性，在 `ResilienceAttempt` 类型中新增 `abort_reason` 字段，在 throw 分支外的 stream_abort attempt 中填充。当前风险极低，可作为后续优化。 |
| 7 | LOW | diagnostic-fields.test.ts:TC10 | **resilience_action='done' 偏离 spec AC5**。spec AC5 明确说"无需重试成功 → resilience_action IS NULL"，但代码存储 `"done"`。测试 TC10 也断言 "done"。"done" 在语义上比 NULL 更有用（确认 resilience 层被咨询过），但这与 spec 不一致。 | 二选一：(a) 修改代码使 success 路径不传 resilienceAction（保持 NULL）；(b) 更新 spec AC5 反映实际行为。推荐 (b) 因为 "done" 更有价值。 |
| 8 | INFO | diagnostic-fields.test.ts | **client_disconnect / loop_detection abort_reason 无测试**。这两种 abort 原因在单元测试中难以程序化触发（client_disconnect 需要中断 TCP 连接，loop_detection 需要构造特定重复模式）。idle_timeout 已在 TC5 中覆盖。 | 可在后续集成测试或手动测试中补充。不阻塞合并。 |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，但不阻塞
> - **INFO**：观察记录，无需操作

#### 等级判定校准说明

- Issue #1（headers_sent 数据丢失）：stream_error 的 headersSent 数据存在但未被提取到 attempt，导致 DB 中永远为 NULL。符合"数据丢失"判定标准 → MUST FIX
- Issue #2（stream_error 无测试）：AC1 的 stream_error 场景完全无测试覆盖，该 kind 是独立的结果类型 → MUST FIX
- Issue #3（failover 无测试）：AC7 的 ProviderSwitchNeeded 场景完全无测试，且该代码路径（failover-loop.ts 第二个 logResilienceResult）是新增 diagnostic 字段的核心消费者之一 → MUST FIX

## 结论

需修改后重审。3 条 MUST FIX 需在提交前修复：(1) headers_sent 未覆盖 stream_error、(2) 补充 stream_error 测试、(3) 补充 failover 路径测试。

## Summary

编码评审完成，第1轮需重审，3条MUST FIX（数据丢失1 + 测试覆盖缺口2），4条LOW，1条INFO。

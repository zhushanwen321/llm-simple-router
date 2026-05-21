---
review:
  type: spec_review
  round: 1
  timestamp: "2026-05-20T22:30:00"
  target: ".xyz-harness/2026-05-20-ai-retry-rule/spec.md"
  verdict: fail
  summary: "Spec 评审完成，第1轮，3条MUST FIX（数据源遗漏、字段不一致、缺少退出路径），需修改后重审"

statistics:
  total_issues: 7
  must_fix: 3
  low: 3
  info: 1

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md > FR3 步骤3"
    title: "响应数据源不完整，流式请求响应内容在 stream_text_content 而非 upstream_response"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 2
    severity: MUST_FIX
    location: "spec.md > FR5 vs FR6"
    title: "AI 返回 JSON schema 不包含摘要字段，但 FR6 UI 要求显示 AI 分析摘要"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 3
    severity: MUST_FIX
    location: "spec.md > FR3 + FR5"
    title: "缺少'不需要重试规则'的退出路径，Background 承诺由 AI 判断但 prompt 强制输出规则"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 4
    severity: LOW
    location: "spec.md > FR3 步骤6-7"
    title: "callLLM 失败路径未在流程步骤中显式列出"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 5
    severity: LOW
    location: "spec.md > FR3 步骤7"
    title: "字段间关系校验缺失：max_delay_ms 与 retry_delay_ms、max_retries=0 的语义"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 6
    severity: LOW
    location: "spec.md > FR5 system prompt"
    title: "{{existing_rules}} 注入格式未指定"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 7
    severity: INFO
    location: "spec.md > FR2"
    title: "llm-client.ts 仅支持 OpenAI 格式，Anthropic 等 Provider 无法使用"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# Spec 评审 v1

## 评审记录
- 评审时间：2026-05-20 22:30
- 评审类型：Spec 评审（纯 spec，无 plan.md）
- 评审对象：`.xyz-harness/2026-05-20-ai-retry-rule/spec.md`

## 逐项检查

### 1. spec 完整性

**目标明确性：** 通过。一段话可概括——"管理员在日志详情页一键触发 AI 分析响应内容，自动生成重试规则配置"。

**范围合理性：** 通过。涉及 1 个新文件（`llm-client.ts`）、1 个新端点、前端 2-3 个组件修改，技术风险低。

**验收标准可量化性：** 部分通过。AC1-AC5 覆盖了主要功能路径和门禁，但存在以下问题：
- AC3 "AI 返回的 JSON 经过完整字段校验"——对"完整"无明确定义（是 FR3 步骤7 列出的 7 个字段？还是更多？）
- AC4 "AI 分析摘要正确显示"——摘要字段的来源在 spec 内部不一致（见 MUST FIX #2）

**[待决议] 项：** 无。但 Background 中"由 AI 判断是否需要创建重试规则"这一承诺未在 FR 中落地（见 MUST FIX #3）。

### 2. spec 内部一致性

**FR3 ↔ FR5 不一致：**
- FR5 的 system prompt 要求 AI 只返回规则 JSON（7 个字段），无 summary/reasoning 字段
- FR6 要求 UI 显示"AI 分析摘要（一段简短文字说明检测到什么错误、为什么推荐这个规则）"
- 结论：AI 没有被要求输出摘要，FR6 的 UI 承诺无法兑现

**Background ↔ FR3/FR5 不一致：**
- Background 说"由 AI 判断是否需要创建重试规则"
- FR5 的 prompt 强制要求返回规则 JSON，无"不生成规则"的退出路径
- 结论：AI 无法表达"不需要重试规则"的判断

**FR3 数据源 vs 实际 DB schema：**
- FR3 步骤3 说从 `upstream_response` 提取响应内容
- 实际上，流式请求的 `upstream_response` 通常为 `{"statusCode":200, "headers":..., "body":null}` 格式，body 为 null
- 流式请求的实际文本内容存储在 `stream_text_content` 字段
- 前端已有 `extractResponseBody(upstream_response) ?? stream_text_content` 的合并逻辑（`request-detail/types.ts`）
- 结论：仅读 `upstream_response` 会遗漏所有流式请求的响应数据

### 3. 约束合规

- 编辑-保存模式：FR1 明确声明遵守 ProxyEnhancement.vue 现有模式 ✅
- shadcn-vue 组件：FR4/FR6 声明使用 Dialog ✅
- 不走代理流程：FR2 明确直接调 Provider ✅
- 禁止 any / eslint-disable：Constraints 中声明 ✅
- 行数限制：Constraints 中声明 ✅

### 4. 遗漏检查

- **安全**：FR3 不发送 client_request（隐私保护）✅，但 `upstream_response` 可能包含上游 API key 等敏感信息，spec 未提及脱敏
- **并发**：AI 调用是同步阻塞的，Constraints 已声明 ✅
- **Provider 删除/禁用后的影响**：如果配置的 provider_id 被删除，spec 未说明处理方式（FR3 步骤1 校验 provider_id 存在性即可）

---

### 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | MUST FIX | spec.md > FR3 步骤3 | **流式请求响应数据遗漏**：`upstream_response` 对流式请求通常只存 headers 元数据（`{statusCode, headers, body:null}`），实际 SSE 文本在 `stream_text_content` 字段。仅读 `upstream_response` 将无法分析流式失败请求（如 429 限流、503 过载中断）。前端已有合并逻辑 `extractResponseBody(upstream_response) ?? stream_text_content`（`request-detail/types.ts`），后端应复用相同策略。 | FR3 步骤3 改为："提取响应上下文：`status_code` + 响应文本（优先从 `upstream_response` 解析 body，为 null 时回退 `stream_text_content`，超过 4000 字符截断）+ `error_message` + `provider_id` + `model`"。 |
| 2 | MUST FIX | spec.md > FR5 vs FR6 | **AI 返回 JSON schema 缺少摘要字段**：FR5 的 system prompt 指定 AI 返回 `{"name", "status_code", "body_pattern", "retry_strategy", "retry_delay_ms", "max_retries", "max_delay_ms"}`，无 summary 字段。但 FR6 要求 UI 显示"AI 分析摘要（一段简短文字说明检测到什么错误、为什么推荐这个规则）"。AI 没有被要求输出这个摘要。 | 在 FR5 的返回 JSON schema 中增加 `"summary"` 字段（一段简短中文说明），并在 FR3 步骤7 的校验中增加 `summary: 非空字符串`。或者去掉 FR6 中的摘要显示要求。二选一，保持一致。 |
| 3 | MUST FIX | spec.md > FR3 + FR5 | **缺少"不需要重试规则"的退出路径**：Background 明确说"由 AI 判断是否需要创建重试规则"，暗示 AI 可以判断不需要创建。但 FR5 的 prompt 用"你必须返回 JSON"强制输出规则，FR3 步骤7 的校验也假设返回一定是规则。当用户对成功请求（200）或明显不可重试的客户端错误触发 AI 分析时，AI 要么生成无意义的规则，要么返回无法解析的内容导致报错。 | 方案 A：在 AI prompt 中增加退出选项，如 `"如果认为不需要重试规则，返回 {"skip": true, "reason": "..."}`"，FR3 步骤7 增加 skip 分支，前端收到 `skip: true` 时显示原因并关闭。方案 B：在 FR3 步骤3 后增加前置检查——status_code 为 200-299 且 error_message 为空时直接返回 `{success: false, error: "该请求未检测到错误，不需要重试规则"}`，不调用 AI。方案 B 更简单可靠。 |
| 4 | LOW | spec.md > FR3 步骤6-7 | **callLLM 失败路径未显式列出**：8 步流程从"调用 callLLM()"直接跳到"解析 AI 返回的 JSON"，未说明网络超时（30s）、Provider 不可用、API key 无效、余额不足等失败场景的处理。虽然 `{success: false, error}` 响应格式可以兜底，但显式列出有助于实现者处理各类错误。 | 在 FR3 步骤6 和步骤7 之间增加一步："callLLM 抛出异常（超时/网络错误/HTTP 错误）时，返回 `{success: false, error: "AI 调用失败: {具体原因}"}`"。 |
| 5 | LOW | spec.md > FR3 步骤7 | **字段间关系校验缺失**：`max_delay_ms` 要求"正整数"但未说明与 `retry_delay_ms` 的关系。exponential 策略下，`max_delay_ms < retry_delay_ms` 语义不合理。`max_retries: 0` 意味着不重试，生成这样的规则没有意义。 | 增加约束：`max_delay_ms >= retry_delay_ms`；`max_retries >= 1`。或在 FR3 中说明这些情况由前端校验。 |
| 6 | LOW | spec.md > FR5 system prompt | **`{{existing_rules}}` 注入格式未指定**：注入现有规则的格式对 AI 输出质量影响大。JSON 数组、逐条文本、表格形式各有优劣，未指定会导致实现者随意选择。 | 建议指定格式，如：`每行一条："[{status_code}] {body_pattern} → {strategy} delay={delay}ms retries={retries}"`，简洁且信息密度高。 |
| 7 | INFO | spec.md > FR2 | **仅支持 OpenAI chat completions 格式**：spec 在 Constraints 中声明了此限制，但未说明当用户配置了 Anthropic 类型的 Provider 时如何处理。实际影响不大（用户会自然选择 OpenAI 兼容的 Provider），仅记录。 | 可在 FR1 配置说明中提示"仅支持 OpenAI 兼容的 Provider"。 |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，但不阻塞
> - **INFO**：观察记录，无需操作

---

### 结论

需修改后重审。

### Summary

Spec 评审完成，第1轮，3条MUST FIX。核心问题：(1) 流式请求响应数据在 `stream_text_content` 而非 `upstream_response`，spec 遗漏此数据源会导致大量流式失败请求无法生成规则；(2) AI prompt 要求返回的 JSON 不含摘要字段，但 UI 设计要求显示摘要；(3) "AI 判断是否需要重试规则"的承诺未在 prompt 和错误处理中落地。修复这 3 项后可进入下一轮评审。

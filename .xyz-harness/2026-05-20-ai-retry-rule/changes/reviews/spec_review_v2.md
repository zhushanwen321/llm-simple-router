---
review:
  type: spec_review
  round: 2
  timestamp: "2026-05-20T23:15:00"
  target: ".xyz-harness/2026-05-20-ai-retry-rule/spec.md"
  verdict: pass
  summary: "Spec 评审完成，第2轮，0条MUST FIX（v1的3条全部已解决），7条LOW/INFO，通过"

statistics:
  total_issues: 11
  must_fix: 0
  must_fix_resolved: 3
  low: 7
  info: 1

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md > FR3 步骤3"
    title: "流式请求响应数据遗漏，仅读 upstream_response"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 2
    severity: MUST_FIX
    location: "spec.md > FR5 vs FR6"
    title: "AI 返回 JSON schema 不包含摘要字段"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 3
    severity: MUST_FIX
    location: "spec.md > FR3 + FR5"
    title: "缺少'不需要重试规则'的退出路径"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
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
    title: "仅支持 OpenAI chat completions 格式，Anthropic 类型 Provider 无法使用"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 8
    severity: LOW
    location: "spec.md > FR3 步骤编号"
    title: "FR3 流程步骤有两个步骤3（前置检查和数据提取），编号重复"
    status: open
    raised_in_round: 2
    resolved_in_round: null
  - id: 9
    severity: LOW
    location: "spec.md > Constraints"
    title: "Constraints 中 'upstream_response 仅发送 TEXT 部分' 未同步更新为包含 stream_text_content 回退逻辑"
    status: open
    raised_in_round: 2
    resolved_in_round: null
  - id: 10
    severity: LOW
    location: "spec.md > FR4 步骤3"
    title: "前端判断'配置相关错误'依赖错误消息字符串匹配，缺乏结构化错误码"
    status: open
    raised_in_round: 2
    resolved_in_round: null
  - id: 11
    severity: LOW
    location: "spec.md > FR3 步骤3（前置检查）"
    title: "'响应体无错误特征'判定标准未定义，实现者需自行设计启发式逻辑"
    status: open
    raised_in_round: 2
    resolved_in_round: null
---

# Spec 评审 v2

## 评审记录
- 评审时间：2026-05-20 23:15
- 评审类型：Spec 评审（纯 spec，无 plan.md）
- 评审对象：`.xyz-harness/2026-05-20-ai-retry-rule/spec.md`

## v1 MUST FIX 修复验证

### #1 流式请求响应数据遗漏 — ✅ 已修复

FR3 步骤3（数据提取）现在明确包含双数据源回退逻辑：
> "响应体文本（优先取 `upstream_response`，为空时回退取 `stream_text_content`，仅 TEXT 部分，超过 4000 字符截断）"

AC3 也同步更新了对应描述。与前端 `extractResponseBody(upstream_response) ?? stream_text_content` 的合并策略一致。

### #2 AI 返回 JSON schema 缺少摘要字段 — ✅ 已修复

三处已对齐：
- **FR5 prompt**：JSON schema 包含 `"summary":"一句话说明检测到什么错误以及推荐策略的原因"`
- **FR3 步骤7 校验**：`summary: 非空字符串（AI 分析摘要，供 UI 展示）`
- **FR3 成功响应**：`{ success: true, rule: {...}, summary: string }`
- **FR6 UI**：`顶部显示 AI 分析摘要（来自 AI 返回的 summary 字段）`

### #3 缺少"不需要重试规则"的退出路径 — ✅ 已修复

双层退出机制已建立：
1. **前置检查**（FR3 第一个步骤3）：2xx + 无 error_message + 无错误特征 → 直接返回 `{ success: false, error: "..." }`，不调用 AI
2. **AI 退出路径**（FR5 prompt）：`"如果响应内容不足以生成有意义的重试规则，请返回 {"error":"无法从此响应中提取重试规则：{原因}"}"`
3. **后端处理**（FR3 步骤7）：AI 返回 `{"error": "..."}` → `{ success: false, error: AI返回的error文本 }`

AC3 新增："2xx 无错误响应被前置拒绝，返回明确提示"

---

## 完整性复检

### 1. spec 完整性

**目标明确性：** 通过。一段话概括：管理员在日志详情页一键触发 AI 分析响应内容，自动生成重试规则配置。

**范围合理性：** 通过。1 个新文件、1 个新端点、2-3 个前端组件修改，技术风险低。

**验收标准可量化性：** 通过。AC1-AC5 覆盖配置、触发、生成、保存、门禁五个维度，每条可写测试验证。

**待决议项：** 无。

### 2. spec 内部一致性

逐项交叉检查：

| 检查点 | FR3（后端） | FR5（Prompt） | FR6（前端） | 一致性 |
|--------|------------|--------------|------------|--------|
| AI 返回字段 | summary + 7 字段 + 校验规则 | summary + 7 字段 JSON schema | 显示 summary + 7 字段表单 | ✅ |
| 数据源 | upstream_response → stream_text_content 回退 | — | — | ✅ |
| 退出路径 | 前置检查 + AI error 处理 | {"error":"..."} 格式 | toast 显示 | ✅ |
| 响应格式 | success: true/false + rule/error | — | 按结果分支处理 | ✅ |

### 3. 约束合规

- 编辑-保存模式：FR1 声明遵守 ProxyEnhancement.vue 模式 ✅
- shadcn-vue 组件：FR4/FR6 声明使用 Dialog ✅
- 不走代理流程：FR2 明确直接调 Provider ✅
- 禁止 any / eslint-disable：Constraints 声明 ✅
- 行数限制：Constraints 声明 ✅

---

### 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | ~~MUST FIX~~ | spec.md > FR3 步骤3 | ~~流式请求响应数据遗漏~~ | **v2 已修复** |
| 2 | ~~MUST FIX~~ | spec.md > FR5 vs FR6 | ~~AI 返回 JSON schema 缺少摘要字段~~ | **v2 已修复** |
| 3 | ~~MUST FIX~~ | spec.md > FR3 + FR5 | ~~缺少退出路径~~ | **v2 已修复** |
| 4 | LOW | spec.md > FR3 步骤6-7 | **callLLM 失败路径未显式列出**：步骤从"调用 callLLM()"直接跳到"解析 AI 返回的 JSON"，未说明网络超时、Provider 不可用、HTTP 错误等失败场景。 | 在步骤6后增加说明："callLLM 抛出异常（超时/网络错误/HTTP 错误）时返回 `{success: false, error: "AI 调用失败: {原因}"}`" |
| 5 | LOW | spec.md > FR3 步骤7 | **字段间关系校验缺失**：`max_retries: 0-100` 允许值为 0（语义上等于不重试），`max_delay_ms` 与 `retry_delay_ms` 无大小关系约束（exponential 策略下 max_delay < delay 不合理）。 | 建议约束：`max_retries >= 1`，`max_delay_ms >= retry_delay_ms` |
| 6 | LOW | spec.md > FR5 system prompt | **`{{existing_rules}}` 注入格式未指定**：不同格式（JSON 数组 vs 逐行文本）对 AI 输出质量有影响。 | 建议指定格式，如每行一条 `"[{status_code}] {body_pattern} → {strategy} delay={delay}ms retries={retries}"` |
| 7 | INFO | spec.md > FR2 | **仅支持 OpenAI 格式**：Constraints 已声明，但 FR1 配置未提示用户选择 OpenAI 兼容的 Provider。 | 可在 FR1 加一句提示 |
| 8 | LOW | spec.md > FR3 步骤编号 | **步骤编号重复**：FR3 有两个步骤3——第一个是前置检查，第二个是数据提取。 | 第二个步骤3 改为步骤4，后续步骤依次递增 |
| 9 | LOW | spec.md > Constraints | **Constraints 文本过时**：原文 "`upstream_response` 仅发送 TEXT 部分，超过 4000 字符截断"，但 FR3 现在还有 `stream_text_content` 回退逻辑，Constraints 未同步更新。 | 改为 "响应体文本仅发送 TEXT 部分，超过 4000 字符截断（数据源优先 `upstream_response`，回退 `stream_text_content`）" |
| 10 | LOW | spec.md > FR4 步骤3 | **"配置相关"错误判断依赖字符串匹配**：前端用"错误为配置相关"做分支判断，但后端 FR3 步骤1 未指定配置缺失时的具体错误消息。实现者需要约定一个错误消息模式让前端匹配，或者使用结构化错误码。 | 方案 A：FR3 步骤1 指定错误消息如 "AI 模型未配置"，前端匹配该字符串。方案 B：后端返回 `{success: false, error: "...", error_code: "config_missing"}`，前端按 error_code 分支。 |
| 11 | LOW | spec.md > FR3 前置检查 | **"响应体无错误特征"判定标准未定义**：前置检查需要后端判断"响应体是否有错误特征"，但未说明具体判定逻辑（关键词匹配？正则？JSON 字段检查？）。实现者需自行设计，可能导致过于宽松或严格。 | 可以简化前置检查条件为 "`status_code` 为 2xx 且 `error_message` 为空"（去掉"响应体无错误特征"），因为 AI prompt 本身已有退出路径兜底。或者明确定义"错误特征"如"响应体包含 error/exception/fail 等关键词"。 |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，但不阻塞
> - **INFO**：观察记录，无需操作

---

### 结论

通过。v1 的 3 条 MUST FIX 均已修复：流式响应数据源回退、summary 字段一致性、AI 退出路径。剩余 7 条 LOW/INFO 为精度提升建议，不阻塞进入 plan 阶段。

### Summary

Spec 评审完成，第2轮通过，0条MUST FIX（v1的3条全部已解决），7条LOW/INFO。

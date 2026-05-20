---
verdict: pass
---

# AI 重试规则生成

## Background

管理员在查看请求日志详情时，发现某个请求响应异常，想要快速为这类响应创建重试规则。当前需要手动分析响应结构、填写 status_code、body_pattern、策略参数等，门槛较高。本功能通过 AI 一键分析响应内容，自动生成推荐的重试规则配置，降低规则创建门槛。

任意请求（不限于失败请求）都可以触发 AI 分析，由 AI 判断是否需要创建重试规则。

## Functional Requirements

### FR1: AI 模型配置

在代理增强页面新增"AI 重试规则生成"配置区块，允许用户选择用于规则生成的 Provider 和 Model。

- 配置项：`provider_id`（从已有 Provider 列表选择）+ `model`（从该 Provider 的模型列表选择）
- 使用现有的 `CascadingModelSelect` 级联选择组件
- 配置存储在 `settings` 表，key = `"ai_retry_config"`，值为 JSON `{"provider_id": "xxx", "model": "gpt-4o-mini"}`
- 遵循代理增强页面现有的编辑-保存交互模式
- 未配置时值为 `null`

### FR2: AI 调用能力

后端新增轻量 LLM 调用工具，通过用户配置的 Provider 直接调用上游 LLM，不走代理流程。

- 调用路径：`getProviderById()` → `decrypt(api_key)` → 构造 OpenAI chat completions 请求 → `http.request` 发送
- 目标 URL：`provider.base_url + (provider.upstream_path || "/v1/chat/completions")`
- 请求格式：`{ model, messages: [{ role: "system", content }, { role: "user", content }], max_tokens: 2048, stream: false }`
- 超时：30 秒
- 新建文件：`src/utils/llm-client.ts`

### FR3: AI 生成重试规则端点

新增 `POST /admin/api/retry-rules/ai-generate` 端点。

请求体：
```typescript
{ log_id: string }
```

后端处理流程：
1. 校验 `ai_retry_config` 是否已配置（`provider_id` + `model` 均非空）
2. 从 DB 读取日志：`getRequestLogById(db, logId)`；日志不存在返回 404
3. **前置检查**：如果 `status_code` 为 2xx 且无 `error_message` 且响应体无错误特征，返回 `{ success: false, error: "该请求响应正常，无需生成重试规则" }`
4. 提取响应上下文：`status_code` + 响应体文本（优先取 `upstream_response`，为空时回退取 `stream_text_content`，仅 TEXT 部分，超过 4000 字符截断）+ `error_message` + `provider_id` + `model`
5. 查询现有所有活跃重试规则列表，注入 prompt 避免生成重复规则
6. 构造 AI prompt（详见 FR5）
7. 调用 `callLLM()`
8. 解析 AI 返回的 JSON（支持 markdown code block 包裹）：
   - 如果 AI 返回 `{"error": "..."}` 格式，表示 AI 判断无法生成规则，返回 `{ success: false, error: AI返回的error文本 }`
   - 否则逐字段校验规则 JSON：
   - `summary`: 非空字符串（AI 分析摘要，供 UI 展示）
   - `name`: 非空字符串
   - `status_code`: 100-599 整数
   - `body_pattern`: 合法正则（`new RegExp()` 不抛异常）
   - `retry_strategy`: "fixed" 或 "exponential"
   - `retry_delay_ms`: 正整数
   - `max_retries`: 0-100 整数
   - `max_delay_ms`: 正整数
9. 校验失败返回错误，让前端提示用户重试

成功响应：
```typescript
{ success: true, rule: { name, status_code, body_pattern, retry_strategy, retry_delay_ms, max_retries, max_delay_ms }, summary: string }
```

失败响应：
```typescript
{ success: false, error: string }
```

### FR4: 日志详情页"生成重试规则"按钮

在 `UnifiedRequestDialog` 组件的左侧元信息栏底部新增"生成重试规则"按钮。

按钮点击行为：
1. 调用 `POST /admin/api/retry-rules/ai-generate`（传 `log_id`）
2. 请求期间按钮显示 loading 状态（spinner + "分析中..."）
3. 后端返回 `success: false` 且错误为配置相关 → 弹出提示 Dialog：
   - 说明需要先在代理增强中配置 AI 模型
   - "前往配置"按钮：`window.open('/admin/proxy-enhancement', '_blank')` 打开新标签页
   - "取消"按钮：关闭提示 Dialog，保留日志详情弹窗
4. 后端返回 `success: true` → 弹出规则预览编辑 Dialog（FR6）
5. 其他错误 → `toast.error()` 提示错误信息

### FR5: AI Prompt 设计

**System Prompt**：

```
你是一个 API 重试规则专家。根据用户提供的 HTTP 错误响应信息，生成一条合适的重试规则。

## 响应分析指南

### 1. 识别错误标识
从响应中找出能唯一标识此类错误的文本片段。优先级：
- 错误码字段：error.code、error.type、code、type 等（如 "overloaded"、"rate_limit_exceeded"、"insufficient_quota"）
- 错误消息中的固定短语：error.message、message、detail 等字段中不随请求变化的固定文本部分（如 "temporarily overloaded"、"context_length_exceeded"）
- 避免提取：动态内容（请求 ID、时间戳、具体 token 数值、文件路径等随请求变化的值）

### 2. 构造 body_pattern 正则
- 使用 | 组合多个错误标识，覆盖同一类错误的不同表述（如 overloaded|server_error）
- 使用 \b 词边界提升精确度（如 \bcontext_length_exceeded\b）
- 不要使用 .* 或 .+ 等过于宽泛的匹配
- 不要硬编码动态值（如具体的数字、UUID、时间戳）
- 目标：能匹配同一类错误的所有实例，但不误匹配其他类型的错误

### 3. 策略选择
- 429 (rate limit)：建议 fixed 策略，delay 5000-30000ms（遵循 Retry-After），max_retries 3-5
- 500/502/503 (服务端错误)：建议 exponential 策略，delay 1000-3000ms，max_retries 3-5
- 400 类客户端错误：一般不应重试，除非是已知的可重试错误（如 "context_length_exceeded" 可触发降级重试）

### 4. 命名规范
格式："{Provider名或通用名} {状态码} {错误类型简述} 重试"
示例："DeepSeek 503 过载重试"、"OpenAI 429 限流重试"

## 现有规则列表（避免生成重复或冲突的规则）：
{{existing_rules}}

如果提供的响应内容不足以生成有意义的重试规则（例如成功响应、无错误特征），请返回：
{"error":"无法从此响应中提取重试规则：{原因}"}

否则，你必须返回规则 JSON，不要返回任何其他内容：
{"summary":"一句话说明检测到什么错误以及推荐策略的原因","name":"...","status_code":...,"body_pattern":"...","retry_strategy":"fixed|exponential","retry_delay_ms":...,"max_retries":...,"max_delay_ms":...}
```

**User Prompt 模板**：

```
Provider: {{provider_id}}
Model: {{model}}
Status Code: {{status_code}}
Error Message: {{error_message}}
Response Body:
{{upstream_response_text}}
```

### FR6: 规则预览编辑 Dialog

弹出 Dialog 展示 AI 生成的规则，复用 `RetryRules.vue` 创建规则 Dialog 的表单结构。

- 所有字段预填 AI 返回值，均可编辑
- 顶部显示 AI 分析摘要（来自 AI 返回的 `summary` 字段，说明检测到什么错误、为什么推荐这个规则）
- 字段：name、status_code、body_pattern（textarea）、retry_strategy（select）、retry_delay_ms、max_retries、max_delay_ms、is_active（toggle，默认开启）
- 底部按钮："取消"和"保存规则"
- 保存时客户端校验（regex 合法性、status_code 范围、数值合理性）
- 保存 → `POST /admin/api/retry-rules` → toast 成功 → 关闭 Dialog

## Acceptance Criteria

### AC1: AI 配置
- [ ] 代理增强页面显示"AI 重试规则生成"配置区块
- [ ] Provider/Model 级联选择正常工作，能展示所有活跃 Provider 及其模型
- [ ] 保存后配置持久化，刷新页面后配置保留
- [ ] 未配置时，`ai_retry_config` 为 `null`

### AC2: 日志详情触发
- [ ] `UnifiedRequestDialog` 左侧栏底部显示"生成重试规则"按钮（带 sparkle 图标）
- [ ] 点击后按钮进入 loading 状态
- [ ] 配置未完成时弹出提示 Dialog，"前往配置"打开新标签页，不关闭日志详情弹窗
- [ ] 配置完成且 AI 调用成功时弹出规则预览编辑 Dialog
- [ ] AI 调用失败时 toast 显示错误信息

### AC3: AI 生成规则
- [ ] 后端从日志中提取 status_code + 响应体文本（优先 `upstream_response`，为空时回退 `stream_text_content`，TEXT 部分 >4000 字符截断）+ error_message + provider_id + model
- [ ] 2xx 无错误响应被前置拒绝，返回明确提示
- [ ] AI prompt 包含现有活跃规则列表
- [ ] AI 返回的 JSON 经过完整字段校验（含 summary）
- [ ] 生成的 body_pattern 为合法正则
- [ ] 解析失败（非 JSON / 字段缺失）返回明确错误信息

### AC4: 规则预览保存
- [ ] 预览 Dialog 所有字段预填且可编辑
- [ ] AI 分析摘要正确显示
- [ ] 保存后规则出现在重试规则列表中
- [ ] 保存后 `RetryRuleMatcher` 内存缓存自动刷新

### AC5: 质量门禁
- [ ] `npm run build` 通过
- [ ] `npm test` 通过
- [ ] `npm run lint` 零警告
- [ ] 前端 `vue-tsc --noEmit` 通过
- [ ] 前端 lint 零警告

## Constraints

- 后端直接调 Provider 上游 API，不走代理流程（无信号量、无日志记录、无重试）
- 仅支持 OpenAI 兼容的 chat completions 格式（`/v1/chat/completions`）
- `upstream_response` 仅发送 TEXT 部分，超过 4000 字符截断
- 不发送 `client_request`（隐私保护）
- AI 调用为同步阻塞，前端通过 loading 状态反馈（5-15s）
- 使用 shadcn-vue 组件，禁止原生 HTML 表单元素
- 前端遵循现有编辑-保存模式（ProxyEnhancement.vue）
- 新增文件行数不超过 300 行，函数不超过 300 行（lint 规则）
- 禁止 `any` 类型，禁止 `eslint-disable` 注释

## Complexity Assessment

**中等复杂度**。

| 维度 | 评估 |
|------|------|
| 后端新增文件 | 1 个（`llm-client.ts`），约 80-120 行 |
| 后端修改文件 | 3-4 个（retry-rules admin、proxy-enhancement admin、settings DB、container） |
| 前端修改文件 | 3 个（ProxyEnhancement.vue、UnifiedRequestDialog、Logs.vue 或 composable） |
| 前端新增组件 | 1 个（规则预览 Dialog，可内联在 UnifiedRequestDialog 中） |
| 技术风险 | 低 — 无新依赖，复用现有 Provider/Settings 基础设施 |
| 测试难度 | 低 — `callLLM` 可 mock，端点可用 `app.inject()` 测试 |

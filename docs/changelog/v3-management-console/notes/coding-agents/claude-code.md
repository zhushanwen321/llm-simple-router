# Claude Code API 格式协议调研

> 基于 claude-code-source-code 源代码分析（截止 2026-05-18）
> 源码位置：`~/GitApp/claude-code-source-code`

---

## 概述

Claude Code **仅使用 Anthropic Messages API 一种协议**，通过 `@anthropic-ai/sdk` SDK 与其后端通信。不存在 OpenAI Chat Completions、OpenAI Responses API 或其他第三方协议的直接调用。

支持的部署模式：
| 模式 | SDK 包 | 端点特征 |
|------|--------|----------|
| **firstParty**（直连） | `@anthropic-ai/sdk` | `api.anthropic.com` |
| **Bedrock**（AWS） | `@anthropic-ai/bedrock-sdk` | AWS Bedrock 端点 |
| **Vertex**（GCP） | `@anthropic-ai/vertex-sdk` | GCP Vertex AI 端点 |
| **Foundry**（Azure） | `@anthropic-ai/foundry-sdk` | Azure AI Foundry 端点 |

所有四种部署模式共享 **同一套 API 格式**（Anthropic Messages Beta API），核心请求逻辑集中在：
- `src/services/api/claude.ts`（3420 行，核心调用生成器）
- `src/services/api/client.ts`（SDK 客户端工厂，按提供者分发）
- `src/services/api/withRetry.ts`（重试/回退逻辑）
- `src/utils/messages.ts`（消息格式转换）
- `src/utils/betas.ts`（功能 beta 头管理）

---

## 使用的 API 协议

### Anthropic Messages Beta API（唯一协议）

**端点**：
- 直连：`POST https://api.anthropic.com/v1/messages?beta=true`（via SDK Beta Messages API）
- Bedrock/Vertex/Foundry：各 SDK 包装后调用等效端点的 `beta` 命名空间

**SDK 调用路径**：
```typescript
// 所有 API 调用都通过此路径
anthropic.beta.messages.create({ ...params }, { ...options })
anthropic.beta.messages.countTokens({ ...params })
```

**两种请求模式**：
1. **Streaming**（主循环）：`anthropic.beta.messages.create({ ...params, stream: true })` → `withResponse()` → 逐事件处理
2. **Non-streaming**（回退/配额检查/Token 计数）：`anthropic.beta.messages.create({ ...params })`

---

## Anthropic Messages API 字段详情

以下是根据 `paramsFromContext()`（src/services/api/claude.ts:1538）和 `queryModel()` 构造的实际请求参数。

### 请求体顶层字段

| 字段 | 类型 | 必需 | 来源/设置位置 | 说明 |
|------|------|------|---------------|------|
| `model` | `string` | 是 | `normalizeModelStringForAPI(options.model)` | 模型 ID，如 `claude-sonnet-4-6`。Bedrock 模式下会解析 Inference Profile |
| `messages` | `MessageParam[]` | 是 | `addCacheBreakpoints(messagesForAPI, ...)` | 对话消息数组。经过 normalizeMessagesForAPI 清洗、ensureToolResultPairing 配对修复、stripExcessMediaItems 限制后注入 |
| `system` | `TextBlockParam[]` | 否 | `buildSystemPromptBlocks(systemPrompt, ...)` | 系统提示词，支持多块缓存控制（cache_control） |
| `tools` | `BetaToolUnion[]` | 否 | `toolToAPISchema()` 构建 | 工具的 JSON schema 描述数组 |
| `tool_choice` | `BetaToolChoiceTool \| BetaToolChoiceAuto` | 否 | `options.toolChoice` | 控制模型是否/如何选择工具：`{type: 'auto'}`、`{type: 'any'}`、或指定工具 `{type: 'tool', name: '...'}` |
| `max_tokens` | `number` | 是 | `retryContext.maxTokensOverride \|\| options.maxOutputTokensOverride \|\| getMaxOutputTokensForModel(model)` | 最大输出 token 数。默认值按模型不同（Haiku ~4096，Sonnet/Opus ~8192+） |
| `thinking` | `object` | 否 | `configureEffortParams()` + thinkingConfig | 思维链配置（详见下文） |
| `temperature` | `number` | 否 | `options.temperatureOverride ?? 1` | 温度参数。仅当 thinking 禁用时发送；thinking 启用时 API 强制要求 1 |
| `metadata` | `object` | 否 | `getAPIMetadata()` | 包含 `user_id`（JSON string，内含 device_id、account_uuid、session_id 及 CLAUDE_CODE_EXTRA_METADATA 扩展） |
| `betas` | `string[]` | 否 | `getMergedBetas()` | Anthropic Beta 功能头列表（详见 Beta Headers 章节） |
| `stream` | `boolean` | 否 | 主循环：`true`；回退：省略 | 是否使用 SSE streaming 响应 |
| `speed` | `'fast'` | 否 | `isFastModeForRetry` 时设置 | 快速模式标识，对应 fast-mode beta 头 |
| `output_config` | `object` | 否 | `extraBodyParams.output_config` 合并 | 输出配置（详见 Output Config 章节） |
| `context_management` | `object` | 否 | `getAPIContextManagement()` | API 端上下文管理策略（详见特殊字段章节） |

### 扩展字段（extraBodyParams）

通过 `CLAUDE_CODE_EXTRA_BODY` 环境变量注入，或由 `getExtraBodyParams()` 添加：

| 字段 | 类型 | 说明 |
|------|------|------|
| `anthropic_beta` | `string[]` | 合并所有 Beta 头（含 Bedrock 特有的来自 `getBedrockExtraBodyParamsBetas()` 的头） |
| `anthropic_internal` | `object` | Ants 内部字段，如 `{ effort_override: number }` |
| `anti_distillation` | `string[]` | 反蒸馏：`['fake_tools']`（仅 1P CLI，受 tengu_anti_distill_fake_tool_injection 门控） |

### messages[] 字段

每条消息的格式（Anthropic Messages API 原生格式）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `role` | `'user' \| 'assistant'` | 消息角色 |
| `content` | `string \| ContentBlockParam[]` | 消息内容。数组支持 text、tool_use、tool_result、thinking、redacted_thinking、image、document 等类型 |
| `cache_control` | `{ type: 'ephemeral', scope?: 'global' \| 'org', ttl?: '1h' }` | 仅添加在最后一条消息上，用于 prompt caching 标记点 |

**content 块类型（BetaContentBlockParam）**：

| type | 额外字段 | 用途 |
|------|----------|------|
| `text` | `text: string` | 文本内容 |
| `tool_use` | `id: string`, `name: string`, `input: object` | 模型发起的工具调用 |
| `tool_result` | `tool_use_id: string`, `content: ContentBlockParam[]`, `is_error?: boolean` | 工具执行结果返回 |
| `thinking` | `thinking: string`, `signature?: string` | 思维链内容 |
| `redacted_thinking` | `data: string` | 被 redact 的思维链 |
| `image` | `source: { type, media_type, data }` | 图像输入（base64） |
| `document` | `source: { type, media_type, data }`, `title?: string`, `context?: string`, `cache_control?: object` | PDF/文档输入 |
| `tool_reference` | （扩展类型） | 工具搜索/动态加载涉及的引用块 |
| `tool_use_block` | （扩展类型） | Deferred tool 加载后的工具块 |
| `cache_edits` | （扩展类型） | 缓存微紧凑（cached microcompact）涉及的编辑块 |

### tools[] 字段

每个工具的 schema（即 `BetaToolUnion`，来自 `@anthropic-ai/sdk`）：

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `name` | `string` | 是 | 工具名称 |
| `description` | `string` | 是 | 工具描述（由 `tool.prompt()` 生成） |
| `input_schema` | `JsonSchema` | 是 | 工具输入的 JSON Schema |
| `strict` | `boolean` | 否 | 是否启用结构化输出 strict 模式（需 tengu_tool_pear FG + 模型支持 Structured Outputs） |
| `defer_loading` | `boolean` | 否 | 是否延迟加载（工具搜索/动态加载使用） |
| `cache_control` | `{ type: 'ephemeral', scope?: 'global' \| 'org', ttl?: '5m' \| '1h' }` | 否 | 工具 schemas 的缓存控制标记 |
| `eager_input_streaming` | `boolean` | 否 | 是否启用细粒度工具流式输入（需 tengu_fgts FG + 1P） |

### system[] 字段

系统提示词是 `TextBlockParam[]` 数组，支持缓存控制：

```typescript
{
  type: 'text',
  text: string,          // 系统提示词内容
  cache_control?: {       // 可选，缓存控制
    type: 'ephemeral',
    scope?: 'global' | 'org',  // global = 跨会话缓存
    ttl?: '1h'                 // 缓存 TTL
  }
}
```

系统提示词经过 `splitSysPromptPrefix()` 按优先级分块：
- 第 0 块：attribution header（`x-anthropic-billing-header`，不缓存）
- 第 1 块：CLI sysprompt prefix（常量前缀，`org` 级缓存或 global 级缓存）
- 第 2+ 块：其余系统提示词（含 dynamic boundary 划分的 static/dynamic 区域）

---

## 特殊字段 / 扩展字段说明

### 1. thinking 字段

```typescript
// 方式一：自适应思考（4.6+ 模型）
{ type: 'adaptive' }

// 方式二：固定预算思考
{ type: 'enabled', budget_tokens: number }  // 默认为 getMaxThinkingTokensForModel()

// 方式三：禁用
{ type: 'disabled' }
```

- `modelSupportsThinking()`：判断模型是否支持 thinking
- `modelSupportsAdaptiveThinking()`：判断模型是否支持自适应 thinking（Opus 4.6+ / Sonnet 4.6+）
- 默认策略：`shouldEnableThinkingByDefault()` 返回 true，默认启用
- thinking 启用时 API 强制体温 `temperature: 1`

### 2. output_config 字段

```typescript
{
  effort?: string,            // 'low' | 'medium' | 'high'（effort-2025-11-24 beta）
  format?: BetaJSONOutputFormat,  // Structured Outputs 格式（structured-outputs-2025-12-15 beta）
  task_budget?: {             // task-budgets-2026-03-13 beta
    type: 'tokens',
    total: number,            // 总 token 预算
    remaining?: number        // 剩余 token 预算
  }
}
```

### 3. context_management 字段

```typescript
{
  type: 'redact_thinking' | 'clear_thinking' | 'clear_all_thinking' | 'summarize'
  // 在 hasThinking 为 true 时可用
  // 需 context-management-2025-06-27 beta 头
  // 由 getAPIContextManagement() 根据阈值触发
}
```

### 4. metadata.user_id 字段

由 `getAPIMetadata()` 构建的 JSON 字符串：

```typescript
JSON.stringify({
  device_id: string,       // 持久设备 ID
  account_uuid: string,    // OAuth 账户 UUID
  session_id: string,      // 当前会话 ID
  ...extra                 // CLAUDE_CODE_EXTRA_METADATA 环境变量注入
})
```

### 5. Beta Headers（由 anthropic_beta 字段承载）

所有 Beta 头合并到 `betas` 数组中发送：

| Beta Header | 常量 | 说明 |
|-------------|------|------|
| `claude-code-20250219` | `CLAUDE_CODE_20250219_BETA_HEADER` | 基础 Claude Code beta |
| `interleaved-thinking-2025-05-14` | `INTERLEAVED_THINKING_BETA_HEADER` | 交错思考 |
| `context-1m-2025-08-07` | `CONTEXT_1M_BETA_HEADER` | 100 万 token 上下文 |
| `context-management-2025-06-27` | `CONTEXT_MANAGEMENT_BETA_HEADER` | 上下文管理策略 |
| `structured-outputs-2025-12-15` | `STRUCTURED_OUTPUTS_BETA_HEADER` | 结构化输出 |
| `web-search-2025-03-05` | `WEB_SEARCH_BETA_HEADER` | 网络搜索 |
| `advanced-tool-use-2025-11-20` | `TOOL_SEARCH_BETA_HEADER_1P` | 工具搜索（1P/Foundry） |
| `tool-search-tool-2025-10-19` | `TOOL_SEARCH_BETA_HEADER_3P` | 工具搜索（Bedrock/Vertex） |
| `effort-2025-11-24` | `EFFORT_BETA_HEADER` | Effort 控制 |
| `task-budgets-2026-03-13` | `TASK_BUDGETS_BETA_HEADER` | 任务 token 预算 |
| `prompt-caching-scope-2026-01-05` | `PROMPT_CACHING_SCOPE_BETA_HEADER` | 全局/组织级缓存范围 |
| `fast-mode-2026-02-01` | `FAST_MODE_BETA_HEADER` | 快速模式 |
| `redact-thinking-2026-02-12` | `REDACT_THINKING_BETA_HEADER` | 思维链 redact |
| `token-efficient-tools-2026-03-28` | `TOKEN_EFFICIENT_TOOLS_BETA_HEADER` | Token 高效工具 |
| `summarize-connector-text-2026-03-13` | `SUMMARIZE_CONNECTOR_TEXT_BETA_HEADER` | 连接器文本摘要 |
| `afk-mode-2026-01-31` | `AFK_MODE_BETA_HEADER` | AFK 自动模式 |
| `advisor-tool-2026-03-01` | `ADVISOR_BETA_HEADER` | 顾问工具（server-side tool） |

### 6. 自定义请求头

SDK 客户端（`getAnthropicClient()`）注入的 HTTP 头：

| Header | 值 | 说明 |
|--------|-----|------|
| `x-app` | `'cli'` | 应用标识 |
| `User-Agent` | `getUserAgent()` | 用户代理 |
| `X-Claude-Code-Session-Id` | `getSessionId()` | 会话 ID，用于后端日志关联 |
| `x-claude-remote-container-id` | `containerId` | 远程容器 ID（CCR 会话） |
| `x-claude-remote-session-id` | `remoteSessionId` | 远程会话 ID（CCR 会话） |
| `x-client-app` | `clientApp` | SDK 消费者应用标识 |
| `x-anthropic-additional-protection` | `'true'` | 额外保护头（由 CLAUDE_CODE_ADDITIONAL_PROTECTION 启用） |
| `anthropic-version` | `'2023-06-01'` | API 版本（仅在 bridge API 中使用） |
| `anthropic-beta` | `'ccr-byoc-2025-07-29'` | CCR BYOC beta（仅在 session history API 中使用） |

---

## 流式响应事件

Streaming 模式下收到的 SSE 事件类型（`BetaRawMessageStreamEvent`）：

| 事件类型 | 说明 | 关键字段 |
|----------|------|----------|
| `message_start` | 消息开始 | `message`（BetaMessage）、`usage` |
| `content_block_start` | 内容块开始 | `index`、`content_block`（含 type、text/thinking/tool_use 等） |
| `content_block_delta` | 内容块增量 | `index`、`delta`（text_delta/thinking_delta/input_json_delta/signature_delta/citations_delta/connector_text_delta） |
| `content_block_stop` | 内容块停止 | `index` |
| `message_delta` | 消息增量 | `delta`（stop_reason、stop_sequence）、`usage` |
| `message_stop` | 消息结束 | - |

---

## API 错误处理

错误类型（来自 `@anthropic-ai/sdk/error`）：

| 错误类型 | 触发条件 |
|----------|----------|
| `APIError` | 通用 API 错误（400/401/403/404/500） |
| `APIConnectionError` | 连接层错误（DNS 解析失败、ECONNRESET、EPIPE） |
| `APIConnectionTimeoutError` | 请求超时（由 SDK 内部超时或 `API_TIMEOUT_MS` 控制） |
| `APIUserAbortError` | 用户取消（Ctrl+C/Esc） |
| 529 错误 | 容量过载（由 `is529Error()` 检测，最多重试 3 次） |

重试策略（`withRetry()`）：
- 默认最大重试：10 次
- 529 重试：3 次（仅前台查询源如 `repl_main_thread`、`sdk`、`agent:*`）
- 降级回退：Streaming 失败 → Non-streaming 回退
- 模型回退：指定 `fallbackModel` 时，超量后降级

---

## 对路由器的兼容性影响

### 正向兼容（容易处理）

Claude Code 严格遵循 Anthropic Messages API 格式，这意味着：

1. **字段清晰可预测**：`model`、`messages`、`system`、`tools`、`max_tokens`、`thinking`、`temperature`、`stream`、`metadata` 等都是 Anthropic 标准字段，可直接转发
2. **Beta 头可剥离**：所有 `betas` 字段是 Anthropic 特有扩展。在非 Anthropic 后端（如 OpenAI 兼容 API）可安全移除
3. **系统提示词格式统一**：`system` 以 `TextBlockParam[]` 发出，Anthropic 格式原生支持

### 潜在兼容问题

1. **Beta 头是必选的**：许多功能（结构输出、Effort、工具搜索、Context Management）依赖 `betas` 数组中的特定头。非 Anthropic 后端收到未知 beta 头可能会拒绝请求
2. **CLAUDE_CODE_EXTRA_BODY**：用户可通过环境变量注入任意额外字段（如 `anthropic_internal`），路由器需要处理此扩展点
3. **Thinking 字段格式**：`thinking: { type: 'adaptive' }` 是 Anthropic 特有格式。OpenAI 等效字段为 `reasoning_effort: 'high' | 'medium' | 'low'`
4. **工具 Schema 扩展字段**：`defer_loading`、`eager_input_streaming`、`cache_control.scope`、`cache_control.ttl` 都是 Anthropic 特有字段，非 Anthropic 后端需过滤

### 协议转换建议

若路由器需要将 Anthropic Messages API 转换为 OpenAI Chat Completions 或 OpenAI Responses API：

| Anthropic 字段 | OpenAI Chat Completions 映射 | OpenAI Responses API 映射 |
|----------------|------------------------------|---------------------------|
| `model` | `model` | `model` |
| `messages` | `messages`（需转换 role 和 content 格式） | `input`（需转换为 input items） |
| `system` | `messages[0].role='system'` | `instructions` |
| `tools` | `tools` | `tools` |
| `tool_choice` | `tool_choice` | `tool_choice` |
| `max_tokens` | `max_tokens` | `max_output_tokens` |
| `thinking: {type: 'adaptive'}` | 无直接映射 | `reasoning: {type: 'thinking'}` |
| `thinking: {type: 'enabled', budget_tokens: N}` | `max_completion_tokens` 含 reasoning | 部分支持 |
| `temperature` | `temperature` | `temperature` |
| `stream: true` | `stream: true` | `stream: true` |
| `betas: [..]` | 忽略（Anthropic 特有） | 忽略 |
| `metadata` | `user` 字段（部分映射） | 忽略 |
| `speed: 'fast'` | 无 | 无 |
| `context_management` | 无 | 无 |
| `output_config` | `response_format`（部分映射） | `text.format`（部分映射） |

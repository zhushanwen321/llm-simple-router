# OpenAI / Anthropic API 格式转换调研

## 业界方案

### 1. LiteLLM（最成熟的开源方案）

Adapter 模式，内部统一为 OpenAI Chat Completions 格式。

- 请求转换：`translate_completion_input_params()` — Anthropic 格式 → OpenAI 格式
- 响应转换：`translate_completion_output_params()` / `translate_completion_output_params_streaming()`
- 流式转换：`AnthropicStreamWrapper` — 拦截 OpenAI SSE chunk，逐个转换为 Anthropic 事件
- 实验性 `/v1/messages` 端点可直接接收 Anthropic 格式请求并路由到 OpenAI/其他 provider
- 源码：`litellm/llms/anthropic/experimental_pass_through/adapters/transformation.py`

### 2. Bifrost（Go 实现，企业级）

字段级映射最详尽，覆盖 Chat Completions 和 Responses API 两种入口。

关键转换：
- 系统消息提取（从 messages 数组移到 `system` 字段）
- 连续 tool 消息合并为单个 user message（Anthropic 要求）
- thinking/reasoning 参数映射
- beta header 自动注入

文档：`https://docs.getbifrost.ai/providers/supported-providers/anthropic`

### 3. LLM-Rosetta（学术论文，hub-and-spoke IR）

用中间表示（IR）做 hub，各 provider 格式转为 IR，IR 再转为目标格式。

定义 6 种流式事件类型：`STREAM_START`、`TEXT_START`、`TEXT_DELTA`、`TOOL_CALL_DELTA`、`TOOL_CALL_END`、`FINISH`。
255 个流式测试用例声称 100% 通过。

论文：`https://arxiv.org/html/2604.09360v1`

### 4. Attractor/StrongDM unified-llm-spec

定义 provider-agnostic 的 `StreamEvent` 类型，各 adapter 负责将 provider 原生 SSE 映射到统一事件。
设计为"四层架构"：Provider Spec → Provider Utilities → Core Client → High-Level API。

规范：`https://github.com/strongdm/attractor/blob/main/unified-llm-spec.md`

---

## 请求格式核心差异

| 维度 | OpenAI Chat Completions | Anthropic Messages |
|------|------------------------|-------------------|
| System 消息 | `messages[]` 中 `role: "system"` | 独立顶层 `system` 字段 |
| 消息交替规则 | 宽松，可连续同 role | 严格 user/assistant 交替 |
| Tool 消息 | `role: "tool"`, `tool_call_id` | `tool_result` content block 放在 user 消息内 |
| Content 结构 | `string` 或 `parts[]` | 始终是 content blocks 数组 |
| Tool 定义 | `{type:"function", function:{name, parameters}}` | `{name, input_schema}` |
| max_tokens | `max_completion_tokens` | `max_tokens` |
| stop | `stop: ["..."]` | `stop_sequences: ["..."]` |
| reasoning | `reasoning: {effort, max_tokens}` | `thinking: {type, budget_tokens}` |
| tool_choice | `"auto"/"none"/"required"/{type:"function",...}` | `"auto"/"none"/"any"/{type:"tool",name:"X"}` |
| response_format | `response_format: {type, json_schema}` | `output_format` 或 structured outputs beta |
| 缓存 | 自动 | 需显式 `cache_control: {type: "ephemeral"}` |
| auth header | `Authorization: Bearer xxx` | `x-api-key: xxx` |

---

## 流式响应格式对比

### OpenAI Chat Completions 流式格式

所有内容在 `choices[].delta` 中，无显式事件类型，块边界靠 delta 字段变化推断。

```
data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}
data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_xxx","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"lo"}}]},"finish_reason":null}]}
data: {"choices":[{"delta":{},"finish_reason":"stop"}]}
data: {"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}
data: [DONE]
```

### Anthropic Messages 流式格式

显式事件类型（`message_start`、`content_block_start/delta/stop`、`message_delta`、`message_stop`），每个内容块有完整生命周期。

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_xxx","role":"assistant","content":[],"usage":{"input_tokens":10}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_xxx","name":"get_weather","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"lo"}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":20}}

event: message_stop
data: {"type":"message_stop"}
```

---

## 流式转换映射

### OpenAI → Anthropic

| OpenAI SSE Event | Anthropic SSE Event |
|---|---|
| 第一个 chunk (role:"assistant") | message_start + content_block_start(text) |
| delta.content 不为空 | content_block_delta(text_delta) |
| delta.tool_calls[*] 首次出现 | content_block_stop(前一个) + content_block_start(tool_use) |
| delta.tool_calls[*].function.args | content_block_delta(input_json_delta) |
| finish_reason 不为空 | content_block_stop + message_delta(stop_reason) + message_stop |
| usage 出现 | 合入 message_delta 的 usage |
| [DONE] | 已由 finish_reason 触发 |

### Anthropic → OpenAI

| Anthropic SSE Event | OpenAI SSE Event |
|---|---|
| message_start | 内部记录 input_tokens，不发 chunk |
| content_block_start(text) | chunk{delta:{role:"assistant"}}（首个块时） |
| content_block_delta(text_delta) | chunk{delta:{content:"..."}} |
| content_block_delta(input_json_delta) | chunk{delta:{tool_calls:[{function:{arguments:"..."}}]}} |
| content_block_start(tool_use) | chunk{delta:{tool_calls:[{id,name,type:"function"}]}} |
| message_delta(stop_reason) | chunk{delta:{}, finish_reason:"stop"} |
| message_stop | chunk{usage:{...}} + [DONE] |

---

## 流式转换核心难点

1. **状态机管理**：OpenAI 的 delta 无类型，转换器须维护状态推断当前内容块类型（文本/工具调用/thinking）
2. **Tool call 参数累积**：OpenAI `arguments` 是逐 chunk JSON 字符串片段，Anthropic `input_json_delta.partial_json` 也是片段——语义等价但需正确转发
3. **Thinking/Reasoning 块**：OpenAI Chat Completions API 没有 thinking 块概念（`reasoning_content` 非标准），需特别处理
4. **Usage 统计时机**：OpenAI 最后单独发 usage chunk；Anthropic 分散在 `message_start`（input）和 `message_delta`（output）中
5. **错误处理**：上游流式错误需转换为客户端期望的错误格式，不能简单透传
6. **Ping 事件**：Anthropic 有 `ping` 事件用于保持连接，OpenAI 没有
7. **content_block_start 的 tool_use**：携带 `id` 和 `name`，需要从 OpenAI 的 `tool_calls[0].id` 和 `function.name` 映射

---

## finish_reason / stop_reason 映射

| Anthropic stop_reason | OpenAI finish_reason |
|---|---|
| `end_turn` | `stop` |
| `stop_sequence` | `stop` |
| `max_tokens` | `length` |
| `tool_use` | `tool_calls` |

---

## usage 字段映射

| Anthropic | OpenAI |
|---|---|
| `input_tokens` | `prompt_tokens` |
| `output_tokens` | `completion_tokens` |
| `cache_read_input_tokens` | `prompt_tokens_details.cached_read_tokens` |
| `cache_creation_input_tokens` | `prompt_tokens_details.cached_write_tokens` |
| 总计 = input + cache_read + cache_creation | `prompt_tokens`（含缓存） |

---

## 当前项目状态

项目目前**没有格式转换**。`proxy-handler.ts:210` 有硬性校验 `provider.api_type !== apiType` 拒绝跨格式路由。请求体和响应体作为 `Record<string, unknown>` / 原始字符串透传。

要支持跨格式路由需：
1. 移除或放宽 `providerTypeMismatch` 校验
2. 在请求链路中插入格式转换层（Handler 层最合适）
3. 在响应/流式链路中插入反向转换（Transport 层之后）
4. 流式转换需实现 SSE 事件状态机解析和重新序列化

**推荐架构**：LiteLLM 的 adapter 模式（直接双向转换）在工程上比 LLM-Rosetta 的 hub-and-spoke 模式更务实。对于本项目已有的三层代理架构（Handler → Orchestrator → Transport），在 Handler 层增加 format transformer 是最自然的切入点。

# OpenAI / Anthropic 格式转换器设计规格

> 日期：2026-04-28 | 状态：草案 | 范围：src/proxy/transform/

---

## 目标

解除入口格式与出口格式的绑定。当前入口 `apiType` 必须匹配 Provider 的 `api_type`，跨格式请求被硬拒绝（`proxy-handler.ts:68`）。新设计允许任意组合：

| 入口 | 出口 | 动作 |
|------|------|------|
| OpenAI | OpenAI | 直通（不变） |
| Anthropic | Anthropic | 直通（不变） |
| OpenAI | Anthropic | 请求转 Anthropic，响应转 OpenAI |
| Anthropic | OpenAI | 请求转 OpenAI，响应转 Anthropic |

---

## 设计决策记录

### DD-1: Provider api_type 保留

**选择**：保留 provider 表的 `api_type` 字段含义不变，仅解除入口-出口绑定。

**理由**：改动最小，语义清晰。Provider 是什么格式就是什么格式，只是路由器多了"翻译"能力。现有代码中 `buildUpstreamHeaders` 已经根据 `apiType` 选择不同的 header 格式（`x-api-key` vs `Authorization`），这个用法合理，不需要修改。

**备选**：去掉入口 `apiType` 概念，自动识别格式。→ 过于复杂，识别精度不可靠，且与现有 Provider 配置语义冲突。

### DD-2: 直接双向转换，不引入中间表示

**选择**：OpenAI ↔ Anthropic 直接双向转换，不引入中间表示（IR）。

**理由**：只有两种格式，N=2 时直接转换比 hub-and-spoke IR 更简单。直接转换的映射函数数是 2，IR 方案需要 2+2=4 个映射函数（两种格式→IR + IR→两种格式），且多一层序列化/反序列化开销。

**备选**：LLM-Rosetta 风格的 hub-and-spoke IR。→ 过度工程化，N=2 时得不偿失。若未来需要支持 Google（Gemini）格式，届时再评估引入 IR。

### DD-3: 转换器位于 Handler 层

**选择**：格式转换在 Handler 层（`proxy-handler.ts`）执行，Transport 层始终用 Provider 原生格式工作。

**理由**：
- 对现有代码侵入最小。Transport（`transport.ts`、`stream-proxy.ts`）不需要知道转换的存在
- 管道清晰：请求方向在 Handler 中转换 body → 传给 Transport → 响应方向在 Handler 中转换 response
- 日志记录使用客户端可见的格式（entry format），Metrics 采集使用 Transport 看到的格式
- 与现有 `applyProviderPatches` 的执行顺序一致：body 先被转换 + patch，再发给 Transport

```
请求: Handler → [Transform Request] → [ProviderPatches] → Orchestrator → Transport
响应: Transport → [Transform Response] → Handler → Client
```

**备选**：在 Transport 层转换。→ Transport 当前是无格式感知的，引入格式概念会破坏其纯粹性。

### DD-4: 完整转换范围

**选择**：文本对话 + 工具调用 + thinking，不含多模态（image/audio）。

**理由**：当前项目只代理文本模型。多模态的 base64 image 格式差异大（OpenAI 用 `content: [{ type: "image_url", image_url: { url: "data:..." } }]`，Anthropic 用 `content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "..." } }]`），当前无此需求，不做。

**字段对照表**：

| 语义 | OpenAI | Anthropic | 转换支持 |
|------|--------|-----------|---------|
| 消息 | `messages[]` | `messages[]` | ✅ |
| system | `messages[{role:"system"}]` | `system` 顶层字段 | ✅ 提取/注入 |
| 用户消息 | `role:"user"`, `content:string` | `role:"user"`, `content:[{type:"text",text:...}]` | ✅ |
| 助理消息 | `role:"assistant"`, `content:string` | `role:"assistant"`, `content:[{type:"text",text:...}]` | ✅ |
| 温度 | `temperature` | `temperature` | ✅ 同名直传 |
| max_tokens | `max_tokens` / `max_completion_tokens` | `max_tokens` | ✅ |
| top_p | `top_p` | `top_p` | ✅ 同名直传 |
| stop | `stop` (array) | `stop_sequences` (array) | ✅ 别名映射 |
| 流式 | `stream: true` | `stream: true` | ✅ |
| 工具定义 | `tools[]` | `tools[]` | ✅ 见 DD-5 |
| 工具调用 | `tool_calls` | `tool_use` content block | ✅ 见 DD-5 |
| 预填充 | `messages[{role:"assistant",content:"..."}]` | `messages[{role:"assistant",content:[{type:"text",text:"..."}]}]` | ✅ 格式归一 |
| Thinking | `reasoning_content` (choices delta) | `thinking` content block | ✅ 见 DD-6 |
| Image | `content:[{type:"image_url"}]` | `content:[{type:"image",source:{}}]` | ❌ 未来 |
| Metadata | `user` | `metadata` | ❌ 影响小 |

### DD-5: 工具调用双向映射

**OpenAI 工具定义**：
```json
{
  "type": "function",
  "function": {
    "name": "get_weather",
    "description": "...",
    "parameters": { "type": "object", "properties": {} }
  }
}
```

**Anthropic 工具定义**：
```json
{
  "name": "get_weather",
  "description": "...",
  "input_schema": { "type": "object", "properties": {} }
}
```

**映射规则**：
- OpenAI → Anthropic：提取 `function.parameters` → `input_schema`，丢 `function.type`（固定 "function"）
- Anthropic → OpenAI：`input_schema` → `function.parameters`，补 `type: "function"` 和 `function.name`

**工具调用（请求中 assistant 消息）**：
- OpenAI `tool_calls` → Anthropic `tool_use` content blocks
- Anthropic `tool_use` content blocks → OpenAI `tool_calls`

**工具结果**：
- OpenAI `role:"tool"` + `tool_call_id` → Anthropic `role:"user"` + `content:[{type:"tool_result",tool_use_id,content}]`
- Anthropic `tool_result` → OpenAI `role:"tool"` + `tool_call_id`

### DD-6: Thinking 尽力转换

**选择**：Anthropic `thinking` content block ↔ OpenAI `reasoning_content` (choices delta) 尽力映射。

**映射**：
- Anthropic 响应 → OpenAI：`content[type="thinking"].thinking` → `choices[0].delta.reasoning_content`
- OpenAI 响应 → Anthropic：`choices[0].delta.reasoning_content` → `content[type="thinking"].thinking`
- OpenAI 请求 → Anthropic：OpenAI 无客户端 thinking 控制，忽略`reasoning_effort`
- Anthropic 请求 → OpenAI：`thinking.type`（enabled/disabled）映射到 `reasoning_effort`（medium/null）

**已知限制**：
- `reasoning_effort` ↔ `budget_tokens` 映射有损。Anthropic 用 token 预算控制 thinking，OpenAI 用枚举（low/medium/high）
- Anthropic 的 thinking 是完整的 content block（有开始/结束标记），OpenAI 的 reasoning_content 只是 delta stream 中的一个可选字段。流式转换需要将 Anthropic 的 `content_block_start/thinking` + `content_block_delta/thinking` + `content_block_stop/thinking` 三元组映射为 SSE 中的 `choices[0].delta.reasoning_content`

### DD-7: 双层插件系统

**选择**：两层架构——Tier 1 声明式规则（DB）+ Tier 2 代码插件（文件系统）。

**Tier 1 — 声明式规则**：
- DB 新增 `transform_rules` 表，字段：`id, entry_type, provider_type, model_pattern, rule_type (header|field|rewrite), config (JSON), priority, is_active, created_at`
- Admin UI 提供 CRUD 管理界面
- 用途：字段重命名、header 增删、简单的 body 字段转换（不需写代码）

**Tier 2 — 代码插件**：
- `plugins/transform/` 目录下 JS 文件
- 每个文件导出 `{name, version, requestTransform?, responseTransform?, streamTransform?}`
- 用途：复杂逻辑（如特殊模型的 uniqueId 映射、自定义认证 header）
- DB 中 `transform_rules.plugin_name` 字段关联文件插件

**执行顺序**：

```
核心转换（内置 DD-4/DD-5/DD-6 映射）
  → Tier 1 声明式规则（按 priority 排序）
    → Tier 2 代码插件（按注册顺序）
      → applyProviderPatches
        → Transport
```

注意：Tier 1 和 Tier 2 仅在 entry_type ≠ provider_type 时执行。直通场景完全跳过。

**热重载**：Admin UI 提供"重载转换规则"按钮，调用 `/admin/api/transform-rules/reload` 端点。Tier 2 插件通过 `clear(require.cache)` 实现热重载（开发阶段也可用）。

### DD-8: 未知字段丢弃

**选择**：只转换已知字段，未知字段丢弃并 `request.log.warn`。

**理由**：两种格式大量字段互不兼容。盲目透传会导致 Provider 报错（如 OpenAI 的 `logprobs` 透传给 Anthropic 会触发 400），或引入安全隐患（如非预期的参数被转发）。

**例外**：`model` 字段保留原值（`proxy-handler.ts` 已经改写 `body.model`），不做格式转换。

---

## 架构概览

### 新增目录结构

```
src/proxy/transform/
├── index.ts              # 入口：TransformCoordinator
├── types.ts              # 共享类型
├── request-transform.ts  # 请求方向转换（非流式+流式相同）
├── response-transform.ts # 响应方向转换（非流式 body）
├── stream-transform.ts   # 响应方向转换（流式 SSE）
├── message-mapper.ts     # 消息结构映射（messages[], roles, content）
├── tool-mapper.ts        # 工具定义 + tool_call ↔ tool_use 映射
├── thinking-mapper.ts    # thinking ↔ reasoning_content 映射
├── usage-mapper.ts       # usage 字段格式映射（可选）
├── plugin-types.ts       # 插件系统类型定义
└── plugin-registry.ts    # 插件加载、热重载、优先级调度
```

### 管道图

**请求方向（非流式+流式相同）**：

```
[客户端 OpenAI POST /v1/chat/completions]
       │
       ▼
openai.ts / anthropic.ts（路由）
       │
       ▼
handleProxyRequest（proxy-handler.ts）
       │
       ├── resolveMapping（模型映射）
       ├── provider.api_type ≠ apiType ？→ 触发转换
       │     │
       │     ▼
       │   TransformCoordinator.request(
       │     entryApiType: "openai",
       │     providerApiType: "anthropic",
       │     body: originalBody
       │   )
       │     │
       │     ├── message-mapper: 重写 messages[] 格式
       │     ├── tool-mapper: 重写 tools[] / tool_calls
       │     ├── 字段别名: stop → stop_sequences 等
       │     └── 丢弃无关字段 + log.warn
       │     │
       │     ▼
       │   （返回转换后的 body）
       │
       ├── applyProviderPatches(body, provider)
       │     │
       │     ▼
       │   Orchestrator → Transport → Upstream
```

**响应方向（非流式）**：

```
Upstream → Transport → callNonStream → {statusCode, body, headers}
       │
       ▼
proxy-handler.ts（收到 TransportResult）
       │
       ├── 若 provider.api_type ≠ apiType
       │     │
       │     ▼
       │   TransformCoordinator.response(
       │     entryApiType: "openai",
       │     providerApiType: "anthropic",
       │     body: upstreamResponseBody
       │   )
       │     │
       │     ├── 解 JSON
       │     ├── 转换 messages/content 格式
       │     ├── 重写 tool_calls ↔ tool_use
       │     ├── 重写 thinking ↔ reasoning_content
       │     ├── 重写 usage 格式
       │     └── 丢弃无关字段 + log.warn
       │
       └── reply.code(...).send(body)
```

**响应方向（流式）**：

```
Upstream SSE → StreamProxy (state machine)
       │
       ▼
buffer → flush → pipeEntry (SSEMetricsTransform)
       │                          │
       │                    metrics 采集（使用 provider 格式）
       │                          │
       ▼                          ▼
TransformCoordinator.stream()    PassThrough → reply.raw
       │
       ├── SSE 事件逐行转换
       ├── Anthropic → OpenAI:
       │   content_block_start/{type:thinking} → choices[0].delta.reasoning_content
       │   content_block_delta/text → choices[0].delta.content
       │   content_block_delta/input_json_delta → choices[0].delta.tool_calls
       │   message_delta/usage → usage 字段
       │   message_start/usage → usage 字段（首帧）
       │   message_stop → [DONE]
       ├── OpenAI → Anthropic:
       │   choices[0].delta.reasoning_content → content_block_start/thinking
       │   choices[0].delta.content → content_block_delta/text
       │   choices[0].delta.tool_calls → content_block_delta/input_json_delta
       │   usage → message_delta/usage
       └── 不匹配的事件丢弃 + log.warn
```

### 关键类和方法

```typescript
// types.ts
export type ApiType = "openai" | "anthropic";

export interface TransformContext {
  entryApiType: ApiType;
  providerApiType: ApiType;
  model: string;
  log: { warn: (msg: string, meta?: object) => void };
}

// TransformCoordinator — 核心调度入口
export class TransformCoordinator {
  // 判断 entry → provider 是否需要转换
  static needsTransform(entry: ApiType, provider: ApiType): boolean {
    return entry !== provider;
  }

  // 请求方向转换
  static request(ctx: TransformContext, body: Record<string, unknown>): Record<string, unknown>;

  // 响应方向转换（非流式）
  static response(ctx: TransformContext, body: string): string;

  // 响应方向流转换
  static stream(ctx: TransformContext): TransformStream;
}
```

### 转换规则

#### OpenAI → Anthropic 请求转换

| OpenAI 字段 | Anthropic 字段 | 规则 |
|-------------|---------------|------|
| `messages` | `messages` | 逐条转换 role/content |
| `messages[{role:"system"}].content` | `system` (顶层) | 提取 system 消息到顶层 |
| `messages[{role:"assistant",content}]` | `messages[{role:"assistant",content:[{type:"text",text}]]` | 字符串 content 转 content array |
| `messages[{role:"user",content}]` | `content:[{type:"text",text}]` | 字符串 content 转 content array |
| `messages[{role:"tool",tool_call_id,content}]` | `content:[{type:"tool_result",tool_use_id,content}]` | 改名 |
| `tools[].function` | `tools[]` | 见 DD-5 |
| `tool_choice: "auto"/"any"/{type:"function",function:{name}}` | `tool_choice: {type:"auto"/"any"/"tool",name}` | 结构不同，需映射 |
| `stop` | `stop_sequences` | 别名 |
| `max_tokens` / `max_completion_tokens` | `max_tokens` | 取大值 |
| `frequency_penalty`, `presence_penalty`, `logit_bias` | ❌ | 丢弃 + warn |
| `response_format` | ❌ | 丢弃 + warn |
| `n`, `top_logprobs`, `seed`, `user` | ❌ | 丢弃 + warn |

#### Anthropic → OpenAI 请求转换

| Anthropic 字段 | OpenAI 字段 | 规则 |
|---------------|-------------|------|
| `system` (顶层) | `messages` 首条 `role:"system"` | 注入 |
| `messages[{role:"user",content:[{type:"text",text}]}]` | `content: string` | content array 简化 |
| `messages[{role:"assistant",content:[{type:"text",text},...]}]` | `content: string` 或保留 array（有 tool_use 时） | 纯文本简化 |
| `messages[{role:"user",content:[{type:"tool_result",tool_use_id,content}]}]` | `role:"tool",tool_call_id,content` | 改名 |
| `tools[].input_schema` | `tools[].function.parameters` | 见 DD-5 |
| `tool_choice: {type, name}` | `tool_choice: "auto"/{type:"function",function:{name}}` | 映射 |
| `stop_sequences` | `stop` | 别名 |
| `thinking` | ❌ | 丢弃 + warn |
| ❌ | `frequency_penalty`, `presence_penalty` 等 | 不填充 |

---

## 与现有代码的集成点

### 改动最少原则

| 文件 | 改动 | 理由 |
|------|------|------|
| `proxy-handler.ts` | 删除 `provider.api_type !== apiType` 硬拒绝 | 这是目前的格式绑定检查点 |
| `proxy-handler.ts` | 在 `resolveMapping` 后、`applyProviderPatches` 前插入转换 | 见管道图 |
| `proxy-handler.ts` | 非流式响应回写前插入 `responseTransform` | 见管道图 |
| `openai.ts` | 无需改动 | 路由入口已经正确 |
| `anthropic.ts` | 无需改动 | 同上 |
| `transport-fn.ts` | `callStream` 管道中插入 `streamTransform` | 流式 SSE 转换 |
| `transport.ts` | 无需改动 | Transport 层无格式感知 |
| `stream-proxy.ts` | 可能需要插入 `FormatStreamTransform` 替换 `PassThrough` | StreamProxy 目前 pipe 到 PassThrough |
| `proxy-core.ts` | 无需改动 | `buildUpstreamHeaders` 的 apiType 参数原生支持 |

### 非侵入式设计

转换器的存在对现有代码完全透明。`needsTransform()` 返回 false 时（直通场景），转换器直接返回原始 body/response，不产生任何性能开销。现有测试不需要修改，新增测试覆盖四种组合。

---

## 四种场景验证

### 场景 1: OpenAI → OpenAI（直通）

```
entry: "openai", provider: "openai"
─────────────────────────────────────
Request:  body 不变（仍为 OpenAI 格式）
Response: body 不变（仍为 OpenAI 格式）
Metrics:  用 openai extractor（不变）
```

### 场景 2: Anthropic → Anthropic（直通）

```
entry: "anthropic", provider: "anthropic"
─────────────────────────────────────────
Request:  body 不变（仍为 Anthropic 格式）
Response: body 不变（仍为 Anthropic 格式）
Metrics:  用 anthropic extractor（不变）
```

### 场景 3: OpenAI → Anthropic（转换）

```
entry: "openai" (POST /v1/chat/completions), provider: "anthropic"
──────────────────────────────────────────────────────────────────
入口:       OpenAI 格式 body（messages, max_tokens, tools, tool_choice...）
Handler:    resolveMapping → entry"openai"≠provider"anthropic" → requestTransform
请求转换:   OpenAI → Anthropic（messages 重构，tools 重写，system 提取，字段丢弃）
Transport:  发送 Anthropic 格式 body 到 provider.base_url + /v1/messages
响应转换:   Anthropic SSE → OpenAI SSE（thinking→reasoning_content, tool_use→tool_calls）
           或 Anthropic JSON → OpenAI JSON（content, usage 重写）
Metrics:    用 anthropic extractor（因为 Transport 看到的是 Anthropic 响应）
回复:       客户端收到 OpenAI 格式响应
```

### 场景 4: Anthropic → OpenAI（转换）

```
entry: "anthropic" (POST /v1/messages), provider: "openai"
───────────────────────────────────────────────────────────
入口:       Anthropic 格式 body（system 顶层, content array, thinking...）
Handler:    resolveMapping → entry"anthropic"≠provider"openai" → requestTransform
请求转换:   Anthropic → OpenAI（system→messages[0], content→string, 字段丢弃）
Transport:  发送 OpenAI 格式 body 到 provider.base_url + /v1/chat/completions
响应转换:   OpenAI SSE → Anthropic SSE（reasoning_content→thinking, tool_calls→tool_use）
           或 OpenAI JSON → Anthropic JSON（content, usage 重写）
Metrics:    用 openai extractor
回复:       客户端收到 Anthropic 格式响应
```

---

## 已知风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 流式转换性能开销 | 增加首 token 延迟和 CPU 开销 | 纯 Transform 流，无 DB 调用，内存 buffer 控制在 4KB |
| Provider SSE 不标准 | 格式转换基于标准 SSE，部分 Provider 可能发非标准事件 | SafeSSEParser + try/catch + warning log |
| Tool call 交错（多个 tool_call 在同一个 SSE 帧中） | 流式转换可能切断 tool_call JSON | buffer + 逐行 flush，JSON 不完整时等待下一帧 |
| 双向转换有损 | 某些字段无法完美映射（thinking budget, n, logprobs） | 文档明确已知差异，日志记录丢弃字段 |
| Usage 格式差异 | OpenAI 嵌套 `usage.prompt_tokens_details`，Anthropic 单层 | 转换时尽力映射，未知子字段丢弃 |
| model 字段被转换 | `body.model` 已被 Handler 改写为 backend_model | 转换器不碰 `model` 字段 |
| 测试覆盖不足 | 4 种场景 × 非流式/流式 × 工具/thinking = 复杂组合 | 优先覆盖核心文本 + 工具调用映射 |
| Anthropic stream 中的 thinking 与 text 交错 | content block 是有序的，转换后需保持 delta 顺序 | 按 SSE event 顺序逐条转换，不重排序 |

---

## 测试策略

### 测试文件

```
tests/transform/
├── request-transform.test.ts    # 请求方向 4 种场景
├── response-transform.test.ts   # 非流式响应 4 种场景
├── stream-transform.test.ts     # 流式 SSE 逐事件转换
├── tool-mapper.test.ts          # 工具定义双向映射
├── thinking-mapper.test.ts      # thinking ↔ reasoning_content
└── message-mapper.test.ts       # 消息结构映射
```

### 测试方式

使用纯函数式测试（不依赖 Fastify/database），直接调用 mapper 函数，验证输入输出：

```typescript
// 示例：OpenAI 请求 → Anthropic 请求
const openaiBody = {
  messages: [{ role: "user", content: "hello" }],
  model: "gpt-4",
  temperature: 0.7,
  max_tokens: 1000,
  stop: ["stop1", "stop2"],
};
const result = requestTransform({
  entryApiType: "openai",
  providerApiType: "anthropic",
  body: openaiBody,
});
expect(result.system).toBeUndefined();
expect(result.messages[0].content).toEqual([{ type: "text", text: "hello" }]);
expect(result.stop_sequences).toEqual(["stop1", "stop2"]);
expect(result.max_tokens).toBe(1000);
expect(result.frequency_penalty).toBeUndefined(); // 丢弃
```

流式测试：构造 SSE 事件序列作为输入，验证输出 SSE 事件序列是否正确。

---

## 实施步骤

### Step 1: 核心映射器（message-mapper, tool-mapper, thinking-mapper）

纯函数，不涉及流式或管道。所有映射逻辑可独立测试。

### Step 2: request-transform / response-transform

组合映射器，实现完整的请求/响应方向非流式转换。

### Step 3: stream-transform

实现 SSE 逐事件转换。关键：处理 content block 开始/增量/结束三元组到 OpenAI choice delta 的映射。

### Step 4: 集成到 Handler

在 `proxy-handler.ts` 中：
- 删除 `provider.api_type !== apiType` 拒绝逻辑
- 在 `applyProviderPatches` 前插入 `requestTransform`
- 在响应回写前插入 `responseTransform`
- 在 `transport-fn.ts` 中插入 `streamTransform` 到 StreamProxy 管道

### Step 5: 声明式规则（Tier 1）

DB migration + Admin UI + 运行时加载。

### Step 6: 代码插件（Tier 2）

`plugin-registry.ts` 加载 `plugins/transform/` 目录。

---

## 附录：关键 SSE 事件映射

### Anthropic event → OpenAI event（流式）

| Anthropic SSE 事件 | OpenAI SSE `choices[0].delta` |
|-------------------|-------------------------------|
| `message_start` | 无（OpenAI 没有对应事件，可选：骨架 `choices[0].delta = {role:"assistant"}`） |
| `content_block_start:{type:"text"}` | 无（等待第一个 delta） |
| `content_block_delta:{type:"text",text:"Hello"}` | `{content:"Hello"}` |
| `content_block_start:{type:"thinking"}` | `{reasoning_content:""}`（标记 thinking 开始） |
| `content_block_delta:{type:"thinking",thinking:"..."}` | `{reasoning_content:"..."}` |
| `content_block_stop:{type:"thinking"}` | `{reasoning_content:null}`（可选） |
| `content_block_start:{type:"tool_use",name:"get_weather"}` | `{tool_calls:[{index:0,id:,type:"function",function:{name:"get_weather",arguments:""}}]}` |
| `content_block_delta:{type:"input_json_delta",partial_json:"..."}` | `{tool_calls:[{index:0,function:{arguments:"..."}}]}` |
| `content_block_stop:{type:"tool_use"}` | 无（arguments 已完整） |
| `message_delta:{usage:{output_tokens:...}}` | `usage` 顶层字段 |
| `message_stop` | `data: [DONE]` |
| `ping` | 丢弃（或转发为 keepalive） |

### OpenAI event → Anthropic event

反向映射即可，关键点：
- `choices[0].delta` 中的多个字段（content + tool_calls 同时出现时）需拆为多个 Anthropic event
- `choices[0].delta.reasoning_content` → `content_block_start/thinking` + `content_block_delta/thinking`
- `[DONE]` → `message_stop`

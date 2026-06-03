# DeepSeek Patch 调研与优化设计

> 合并自：
> - `docs/deepseek-patch-investigation.md`（调研文档，2026-04）
> - `docs/design/2026-04-30-deepseek-patch-optimization.md`（设计文档，2026-04-30，分支：feat-deepseek-compat）

## 目录

- [1. 问题现象](#1-问题现象)
- [2. 调研分析](#2-调研分析)
- [3. 优化设计](#3-优化设计)
- [4. 执行计划](#4-执行计划)
- [5. 附录](#5-附录)

---

## 1. 问题现象

### 1.1 跨模型切换错误

同一 agent 会话中，先使用其他模型（如 GLM）进行对话，然后切换到 DeepSeek（Anthropic API 端点），切换后 DeepSeek 返回 400 错误：

```
The `content[].thinking` in the thinking mode must be passed back to the API.
```

### 1.2 工具调用无限循环

在上面问题的后续（DeepSeek 上发起工具调用）中，出现**工具调用无限循环**——同一个工具被反复调用，无法停止。

---

## 2. 调研分析

### 2.1 问题根因

#### 2.1.1 DeepSeek Anthropic API 的 thinking 校验规则

通过实验验证（`scripts/test-deepseek-patch.mjs`），DeepSeek 对历史消息中 thinking 块的校验规则：

| 场景 | 结果 |
|------|------|
| thinking enabled，纯文本 assistant 缺 thinking | ✅ 200，**不强制要求** |
| thinking enabled，含 tool_use 的 assistant 缺 thinking | ❌ 400，**强制要求** |
| thinking enabled，含 tool_use 且 thinking.signature 为空 | ❌ 400 |
| thinking disabled（不传 body.thinking），含 tool_use 缺 thinking | ✅ 200 |

核心结论：**只有在 thinking 模式激活时，含 tool_use 的 assistant 消息才强制要求携带 thinking 块。**

#### 2.1.2 signature 字段的本质

通过多轮 API 调用观察，DeepSeek 的 `signature` 字段是 UUID v4 格式（如 `3efe47c9-054d-4f18-9485-7793a6d61525`），**不是加密签名**。每次请求的 signature 都不同，DeepSeek 只验证字段存在且非空，不验证值的真实性。全零 UUID `00000000-0000-0000-0000-000000000000` 和随机 UUID 均通过校验。

#### 2.1.3 无限循环的机制

原补丁插入 `{type: "thinking", thinking: "", signature: ""}`（空签名），DeepSeek 将其视为"thinking 链断裂"，**忽略该消息中的 tool_use 块**。模型认为该工具调用"没发生过"，于是重新生成同样的 tool_use → 结果返回后补丁再次插入空 thinking → 模型再次忽略 → 循环。

### 2.2 原始补丁

#### 2.2.1 初始实现（commit `3e59744`）

在 `src/proxy/proxy-handler.ts` 中直接内联函数 `patchMissingThinkingBlocks`，扫描所有 assistant 消息，对缺少 thinking 块的插入：

```typescript
msg.content.unshift({ type: "thinking", thinking: "", signature: "" });
```

后来重构到独立模块 `src/proxy/patch/deepseek/patch-thinking-blocks.ts`，并增加了 `patchOrphanToolResults` 处理上下文截断产生的孤儿 tool_result。

#### 2.2.2 第一次修复尝试（方向错误）

在 `patchMissingThinkingBlocks` 中增加判断：含 tool_use 的消息跳过不修补。

**问题**：这个修复方向是错的——测试证明含 tool_use 的消息**必须**有 thinking 块，跳过会导致 400 错误。

### 2.3 解决方案对比

| # | 方案 | 校验结果 | 工具调用 | 备注 |
|---|------|---------|---------|------|
| 1 | 空 thinking `{thinking:"",signature:""}` + tool_use | ✅ 200 | ❌ 无限循环 | 最初方案 |
| 2 | 跳过 tool_use（不修补） | ❌ 400 | — | 校验失败 |
| 3 | `redacted_thinking` 替代 thinking | ❌ 400 | — | DeepSeek 不支持此类型 |
| 4 | 复制相邻消息的 signature `{thinking:"",signature:"COPIED"}` | ✅ 200 | ❌ 隐患同上 | 签名与内容不匹配 |
| 5 | 自生成 UUID `{thinking:"",signature:crypto.randomUUID()}` | ✅ 200 | ❌ 隐患同上 | thinking 内容仍为空 |
| 6 | 剥离 history 中所有 thinking + 删除 `body.thinking` | ✅ 200 | ✅ 正常 | 但**永久无法恢复 thinking** |
| 7 | 非 DeepSeek 的 tool_use/tool_result → text（**选定方案**） | ✅ 200 | ✅ 正常 | 信息保留，自愈 |

#### 2.3.1 各方案详细分析

**方案 2：跳过 tool_use** — 纯文本消息不加 thinking（DeepSeek 不要求），含 tool_use 的消息跳过。致命缺陷：含 tool_use 的消息**强制要求** thinking 块，跳过会导致 400。

**方案 3：`redacted_thinking`** — Anthropic API 原生支持的 `RedactedThinkingBlock {type:"redacted_thinking", data:""}`，不需要 signature 字段。致命缺陷：DeepSeek Anthropic 兼容实现不完整，返回 400: `unknown variant 'redacted_thinking'`。

**方案 6：剥离所有 thinking + 删除 `body.thinking`** — 检测到历史不一致时清空所有 thinking 块，不传 `body.thinking`。致命缺陷：后续请求**永久无法恢复 thinking 模式**，因为被转换的 tool_use 消息仍在历史中，再次开启 `body.thinking` 时校验立即触发。

**方案 5 vs 方案 7** — 两者都能通过校验。方案 5（自生成 UUID）仍然伪造 thinking 块，空内容可能对模型理解产生微妙影响。方案 7 完全避免伪造，将 tool_use 降级为自然语言格式。

### 2.4 最终方案：tool_use/tool_result → text

#### 2.4.1 核心思路

**不修补（伪造），而是降级（格式转换）。** 将非 DeepSeek 生成的消息中的 `tool_use`/`tool_result` 转为 text 块，从格式层面规避校验，同时完整保留工具调用信息。

#### 2.4.2 判断标准

"非 DeepSeek 生成"的 assistant 消息：
- content 数组中有 `tool_use` 块，且
- 无 `thinking` 块，或 `thinking.signature` 为空/缺失

#### 2.4.3 转换示例

```
补丁前（GLM 历史）:
  assistant [{tool_use: read, id: call_1}]
  user      [{tool_result: call_1, content: "file content"}]

补丁后:
  assistant [{text: '{"type":"tool_use","id":"call_1","name":"read",...}'}]
  user      [{text: '{"type":"tool_result","tool_use_id":"call_1",...}'}]
```

DeepSeek 原生消息（有合法 thinking + signature）保留不动。

#### 2.4.4 选择理由

1. **不伪造内容**：不生成任何假 thinking/signature，语义正确
2. **信息完整保留**：tool_use/tool_result 通过 JSON 序列化保留全部字段
3. **一次性修复 + 自愈**：只需首轮转换非 DeepSeek 消息，后续 DeepSeek 回复自带合法 thinking，补丁自动退出
4. **工具调用正常**：降级为 text 后不影响 DeepSeek 继续发起新工具调用（实测验证）
5. **无永久退化**：不同于"剥离 thinking"方案，DeepSeek 原生消息保留完整，thinking 能力不丢失

#### 2.4.5 与 patchOrphanToolResults 的关系

执行顺序不变：
1. `patchNonDeepSeekToolMessages` — 将非 DeepSeek 的 tool_use/tool_result 转为 text
2. `patchOrphanToolResults` — 处理 DeepSeek 原生消息中因 Claude Code 上下文截断产生的孤儿 tool_result

两者协同：补丁 1 降低了补丁 2 需要处理的范围（非 DeepSeek 的消息已转为 text，不会被误判）。

### 2.5 同类开源项目调研

| 项目 | 处理方式 |
|------|---------|
| **litellm** | 检测到不一致时**删除 body.thinking 参数**降级（放弃本轮思考），不做消息修补 |
| **langchain** | 请求路径中**静默剥离** reasoning/thinking 块，完全不处理跨模型兼容 |
| **octopus** | 有完整的 Anthropic↔OpenAI 格式转换器，但不做消息历史修补 |

三个项目均未处理"跨模型切换时为 tool_use 消息补 thinking 块"这一场景。本项目的方案 B（tool_use→text）是该问题的独有解决方案。

---

## 3. 优化设计

### 3.1 背景

#### 3.1.1 Pi 的 compat 体系

Pi 对 DeepSeek 模型定义了 `compat` 配置，通过声明式字段描述兼容差异，运行时由 `openai-completions.js` 读取并转换请求：

```json
{
  "requiresReasoningContentOnAssistantMessages": true,
  "thinkingFormat": "deepseek",
  "reasoningEffortMap": {
    "minimal": "high",
    "low": "high",
    "medium": "high",
    "high": "high",
    "xhigh": "max"
  }
}
```

Pi 作为客户端，核心转换逻辑：
- `thinkingFormat: "deepseek"` → 发送 `thinking: { type: "enabled" }`（非 OpenAI 标准参数）
- `reasoningEffortMap` → 将 OpenAI 5 级 reasoning_effort 映射为 DeepSeek 的 `high` / `max`
- `requiresReasoningContentOnAssistantMessages` → 给历史 assistant 消息补 `reasoning_content: ""`
- assistant content 始终用 string 发送（避免 NIM 等端点回显嵌套结构）

#### 3.1.2 我们的区别

我们是 **API 代理路由器**，不是客户端。需要同时处理：
- **请求方向**：客户端 → 代理 → DeepSeek（请求体 patch）
- **双协议**：OpenAI `/v1/chat/completions` 和 Anthropic `/v1/messages` 两条路径
- **代理特有问题**：历史消息截断导致孤儿 tool_result、多客户端消息格式差异

#### 3.1.3 当前 Patch 架构

```
src/proxy/patch/
├── index.ts                           # 入口：按 provider 分发
├── router-cleanup.ts                  # 通用：移除 router 合成的 tool_use/tool_result
└── deepseek/
    ├── index.ts                       # DeepSeek patch 入口
    ├── patch-thinking-blocks.ts        # Anthropic: 补空 thinking block
    └── patch-orphan-tool-results.ts    # Anthropic: 清理孤儿 tool_result
```

**核心问题**：当前 patch **不感知 apiType**。`ProviderInfo` 只声明了 `base_url`，所有补丁只处理 Anthropic 格式。OpenAI 协议请求经过 DeepSeek patch 时静默跳过，不生效。

### 3.2 现状分析

#### 3.2.1 调用链

```
proxy-handler.ts: handleProxyRequest()
  → applyProviderPatches(currentBody, provider)   // provider 含 api_type 但被忽略
    → needsDeepSeekPatch(body, provider)           // 仅检测 base_url 和 model 名
      → applyDeepSeekPatches(body)                 // 不接收 apiType
        → patchMissingThinkingBlocks(body)          // 只处理 Anthropic content block 格式
        → patchOrphanToolResults(body)              // 只处理 Anthropic tool_use/tool_result 格式
```

#### 3.2.2 当前 Patch 能力矩阵

| Patch | 协议格式 | 状态 |
|-------|---------|------|
| 补空 thinking block | 仅 Anthropic (`{ type: "thinking" }`) | ✅ 已实现 |
| 清理孤儿 tool_result | 仅 Anthropic (`tool_use` / `tool_result`) | ✅ 已实现 |
| 补 `reasoning_content: ""` | 仅 OpenAI 需要的字段 | ❌ 缺失 |
| 注入 `thinking` 参数 | 双协议都需要 | ❌ 缺失 |
| `reasoning_effort` 映射 | 仅 OpenAI 需要的映射 | ❌ 缺失 |
| `cache_control` 剥离 | 仅 Anthropic | ❌ 缺失 |
| 空 assistant 清理 | 双协议 | ❌ 缺失 |
| assistant content string 化 | 仅 OpenAI | ❌ 缺失 |

### 3.3 OpenAI 协议优化项

> 客户端通过 `/v1/chat/completions` → DeepSeek API

#### 3.3.1 [P0] 补 `reasoning_content: ""` 字段

**问题**：DeepSeek API 要求历史中每个 assistant 消息必须包含 `reasoning_content` 字段（即使是空字符串），否则报校验错误。

**Pi 的做法**：
```js
if (compat.requiresReasoningContentOnAssistantMessages &&
    model.reasoning &&
    assistantMsg.reasoning_content === undefined) {
    assistantMsg.reasoning_content = "";
}
```

**实现方案**：
```typescript
// 新文件：patch-deepseek-openai.ts
export function patchOpenAIReasoningContent(body: Record<string, unknown>): void {
  if (!body.messages) return;
  const messages = body.messages as Array<Record<string, unknown>>;

  // 检测 thinking 是否激活：显式参数 或 历史中存在 reasoning_content
  const thinkingActive = !!body.thinking || messages.some(
    (msg) => msg.role === "assistant" && msg.reasoning_content !== undefined,
  );
  if (!thinkingActive) return;

  for (const msg of messages) {
    if (msg.role === "assistant" && msg.reasoning_content === undefined) {
      msg.reasoning_content = "";
    }
  }
}
```

#### 3.3.2 [P1] `reasoning_effort` 映射

**问题**：OpenAI 定义 5 级 reasoning_effort（minimal/low/medium/high/xhigh），DeepSeek 只接受 `high` 和 `max`。直接透传不支持的值会导致上游报错。

**Pi 的做法**：
```js
{ minimal: "high", low: "high", medium: "high", high: "high", xhigh: "max" }
```

**实现方案**：
```typescript
const DEEPSEEK_EFFORT_MAP: Record<string, string> = {
  minimal: "high", low: "high", medium: "high",
  high: "high", xhigh: "max",
};

export function patchReasoningEffort(body: Record<string, unknown>): void {
  const effort = body.reasoning_effort as string | undefined;
  if (effort && DEEPSEEK_EFFORT_MAP[effort]) {
    body.reasoning_effort = DEEPSEEK_EFFORT_MAP[effort];
  }
}
```

#### 3.3.3 [P1] 自动注入 `thinking` 参数

**问题**：DeepSeek 使用非标准的 `thinking: { type: "enabled" }` 参数控制思考模式。客户端可能不传，但历史中有 thinking 内容。

**实现方案**：
```typescript
export function patchThinkingParamOpenAI(body: Record<string, unknown>): void {
  if (body.thinking) return;
  const messages = body.messages as Array<Record<string, unknown>> | undefined;
  if (!messages) return;

  const hasThinking = messages.some(msg =>
    msg.role === "assistant" && msg.reasoning_content !== undefined
  );
  if (hasThinking) {
    body.thinking = { type: "enabled" };
  }
}
```

#### 3.3.4 [P2] assistant content string 化

**问题**：部分非官方端点（如 NVIDIA NIM 托管的 DeepSeek）会把 `[{type:"text", text:"..."}]` 原样回显，产生递归嵌套。

**Pi 的做法**：始终将 assistant content 作为 string 发送，而非 content block 数组。

**影响范围**：仅限非官方端点，直连 `api.deepseek.com` 不受影响。优先级低。

### 3.4 Anthropic 协议优化项

> 客户端通过 `/v1/messages` → DeepSeek Anthropic 兼容端点

#### 3.4.1 [P0] `signature` 字段一致性

**问题**：当前补丁注入 `{ type: "thinking", thinking: "", signature: "" }`。标准 Anthropic 的 thinking block 有加密 `signature` 字段用于验证完整性。DeepSeek 的 Anthropic 兼容 API 对 `signature` 的处理可能不一致——传空字符串在某些版本下可能触发校验错误。

**改进方向**：检测历史中 thinking block 是否带 `signature` 字段，仅在必要时补入。

#### 3.4.2 [P1] 自动注入 `thinking` 参数

**问题**：Anthropic 格式要求 `thinking: { type: "enabled", budget_tokens: N }`。客户端后续请求可能不传，但历史中有 thinking block，导致 DeepSeek 行为不可预测。

#### 3.4.3 [P1] `cache_control` 剥离

**问题**：Claude Code 等客户端会在 content block 上标注 `cache_control: { type: "ephemeral" }`。DeepSeek 不支持 Anthropic 的 `cache_control`，会报 `unexpected field` 错误。当前完全透传，未做剥离。

#### 3.4.4 [P1] 空 assistant 消息清理

**问题**：`patchOrphanToolResults` 清理孤儿后，可能出现 assistant 消息所有 tool_use 被移除（因对应的 tool_result 也是孤儿），只剩空 content 数组 `[]`。Anthropic 协议要求 assistant 消息必须有内容。

#### 3.4.5 [P2] thinking block 位置校验

**问题**：Anthropic 协议要求 thinking block 是 assistant content 的第一个元素。当前用 `unshift` 保证插入位置正确，但不处理历史中 thinking block 不在首位的情况。

#### 3.4.6 [P2] tool_use 合并去重

**问题**：连续 assistant 消息合并时，可能出现重复 tool_use id。需在合并时去重。

---

## 4. 执行计划

### 4.1 总览

| 步骤 | 任务 | 优先级 | 新增/修改文件 |
|------|------|--------|-------------|
| 1 | 架构改造：apiType 感知 | P0 | `patch/index.ts`, `patch/deepseek/index.ts` |
| 2 | `cache_control` 剥离 | P1 | `patch/deepseek/patch-cache-control.ts`（新增） |
| 3 | `thinking` 参数自动注入 | P1 | `patch/deepseek/patch-thinking-param.ts`（新增） |
| 4 | `signature` 字段一致性 | P0 | `patch/deepseek/patch-thinking-blocks.ts`（修改） |
| 5 | 空 assistant 消息清理 | P1 | `patch/deepseek/patch-orphan-tool-results.ts`（修改） |
| 6 | thinking block 位置修正 | P2 | `patch/deepseek/patch-thinking-blocks.ts`（修改） |
| 7 | tool_use 合并去重 | P2 | `patch/deepseek/patch-orphan-tool-results.ts`（修改） |
| 8 | 提取共享工具函数 | P2 | `patch/deepseek/utils.ts`（新增） |
| 9 | 补充测试 | P1 | `tests/patch.test.ts`（修改） |

### 4.2 步骤 1：架构改造 — apiType 感知

**目标**：让整个 patch 链路知道当前请求的 API 类型，为后续 OpenAI patch 铺路。

**修改文件**：`src/proxy/patch/index.ts`

```typescript
// 改前
interface ProviderInfo {
  base_url: string;
}

export function applyProviderPatches(
  body: Record<string, unknown>,
  provider: ProviderInfo,
): { body: Record<string, unknown>; meta: ProviderPatchMeta }

// 改后
interface ProviderInfo {
  base_url: string;
  api_type: "openai" | "anthropic";
}

export function applyProviderPatches(
  body: Record<string, unknown>,
  provider: ProviderInfo,
): { body: Record<string, unknown>; meta: ProviderPatchMeta } {
  if (needsDeepSeekPatch(body, provider)) {
    const cloned = JSON.parse(JSON.stringify(body));
    applyDeepSeekPatches(cloned, provider.api_type);
    return { body: cloned, meta: { types: ["deepseek"] } };
  }
  return { body, meta: { types: [] } };
}
```

**修改文件**：`src/proxy/patch/deepseek/index.ts`

```typescript
// 改后：按 apiType 分发，保持现有 Anthropic 逻辑不变
export function applyDeepSeekPatches(
  body: Record<string, unknown>,
  apiType: "openai" | "anthropic",
): void {
  if (apiType === "anthropic") {
    patchThinkingParam(body, apiType);
    stripCacheControl(body);
    patchMissingThinkingBlocks(body);
    patchOrphanToolResults(body);
  }
  // OpenAI patch 留给后续 PR
}
```

**影响范围**：调用方 `proxy-handler.ts` 传入的 `provider` 已经是完整的 `Provider` 对象（含 `api_type`），无需修改调用方。仅接口声明扩展。

**验证**：现有测试中 `applyProviderPatches(body, { base_url: "..." })` 需要补上 `api_type` 参数。

### 4.3 步骤 2：`cache_control` 剥离

**目标**：DeepSeek 不支持 Anthropic 的 `cache_control`，需要从请求体中移除所有 `cache_control` 字段。

**新增文件**：`src/proxy/patch/deepseek/patch-cache-control.ts`

```typescript
/**
 * DeepSeek 的 Anthropic 兼容 API 不支持 cache_control。
 * Claude Code 等客户端会在 content block 和 system prompt 上标注
 * cache_control: { type: "ephemeral" }，需要剥离以避免上游报错。
 */
export function stripCacheControl(body: Record<string, unknown>): void {
  // 处理顶级 system 字段（Anthropic 协议中 system 可以是 content block 数组）
  if (Array.isArray(body.system)) {
    for (const block of body.system as Array<Record<string, unknown>>) {
      delete block.cache_control;
    }
  }

  // 处理 messages 中的 content block
  if (!body.messages) return;
  const messages = body.messages as Array<Record<string, unknown>>;

  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content as Array<Record<string, unknown>>) {
        delete block.cache_control;
      }
    }
  }

  // 处理 tools 上的 cache_control
  if (Array.isArray(body.tools)) {
    for (const tool of body.tools as Array<Record<string, unknown>>) {
      delete tool.cache_control;
    }
  }
}
```

**测试用例**：
```typescript
it("移除 messages 中的 cache_control", () => {
  const body = {
    system: [{ type: "text", text: "You are helpful", cache_control: { type: "ephemeral" } }],
    messages: [
      { role: "user", content: [
        { type: "text", text: "hello", cache_control: { type: "ephemeral" } },
      ]},
      { role: "assistant", content: [
        { type: "thinking", thinking: "hmm", cache_control: { type: "ephemeral" } },
        { type: "text", text: "hi" },
      ]},
    ],
    tools: [{ name: "read", cache_control: { type: "ephemeral" } }],
  };
  stripCacheControl(body);
  // 所有 cache_control 都被移除
  expect(JSON.stringify(body)).not.toContain("cache_control");
});
```

### 4.4 步骤 3：`thinking` 参数自动注入

**目标**：当历史中存在 thinking block 但请求未传 `thinking` 参数时，自动注入，确保 DeepSeek 正确处理。

**新增文件**：`src/proxy/patch/deepseek/patch-thinking-param.ts`

```typescript
/**
 * DeepSeek 开启 thinking 后，后续请求必须显式传 thinking 参数。
 * 客户端（如 Claude Code）可能在后续轮次省略此参数。
 * 检测历史中是否存在 thinking 内容，自动补上参数。
 */
export function patchThinkingParam(
  body: Record<string, unknown>,
  apiType: "openai" | "anthropic",
): void {
  if (body.thinking) return;

  const messages = body.messages as Array<Record<string, unknown>> | undefined;
  if (!messages) return;

  const hasThinking = messages.some(msg => {
    if (msg.role !== "assistant") return false;
    if (apiType === "openai") {
      return msg.reasoning_content !== undefined;
    }
    // Anthropic 格式
    return Array.isArray(msg.content) &&
      (msg.content as Array<Record<string, unknown>>)
        .some(b => b?.type === "thinking");
  });

  if (!hasThinking) return;

  if (apiType === "openai") {
    body.thinking = { type: "enabled" };
  } else {
    // Anthropic 格式要求 budget_tokens
    body.thinking = { type: "enabled", budget_tokens: 10000 };
  }
}
```

**关于 `budget_tokens`**：Anthropic API 要求 `thinking.type === "enabled"` 时必须带 `budget_tokens`。DeepSeek 兼容 API 继承了这一要求。10K 是安全默认值，不会限制实际思考深度（DeepSeek 会自行决定 thinking token 数）。

**测试用例**：
```typescript
describe("patchThinkingParam", () => {
  it("Anthropic: 历史有 thinking block 但无参数时注入", () => {
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "hi" }] },
        { role: "user", content: "continue" },
      ],
    };
    patchThinkingParam(body, "anthropic");
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 10000 });
  });

  it("已有 thinking 参数时不覆盖", () => {
    const body = {
      thinking: { type: "enabled", budget_tokens: 5000 },
      messages: [],
    };
    patchThinkingParam(body, "anthropic");
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 5000 });
  });

  it("无 thinking 历史时不注入", () => {
    const body = {
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
      ],
    };
    patchThinkingParam(body, "anthropic");
    expect(body.thinking).toBeUndefined();
  });
});
```

### 4.5 步骤 4：`signature` 字段一致性

**目标**：检测历史 thinking block 的格式，仅在必要时补 `signature` 字段。

**修改文件**：`src/proxy/patch/deepseek/patch-thinking-blocks.ts`

**修改范围**：`patchMissingThinkingBlocks` 函数内的 block 构造逻辑。

```typescript
// 改前
(msg.content as Array<Record<string, unknown>>).unshift(
  { type: "thinking", thinking: "", signature: "" }
);

// 改后
// 先扫描历史中 thinking block 是否带 signature
let needsSignature = true;
for (const msg of messages) {
  if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
  for (const b of msg.content as Array<Record<string, unknown>>) {
    if (b?.type === "thinking") {
      needsSignature = "signature" in b;
      break;
    }
  }
  if (!needsSignature) break;
}

// 补丁时保持一致
const emptyThinking: Record<string, unknown> = { type: "thinking", thinking: "" };
if (needsSignature) emptyThinking.signature = "";

(msg.content as Array<Record<string, unknown>>).unshift(emptyThinking);
```

**验证**：现有测试在默认场景（有 thinking block 在历史中）下行为不变。新增一个不带 signature 的测试用例。

### 4.6 步骤 5：空 assistant 消息清理

**目标**：orphan 清理后，移除 content 为空的 assistant 消息，避免 DeepSeek 校验失败。

**修改文件**：`src/proxy/patch/deepseek/patch-orphan-tool-results.ts`

**修改范围**：在函数末尾追加清理逻辑。

```typescript
// 在现有 Step 5 (mergeConsecutive assistant) 之后添加：

// Step 6: 移除 content 为空数组的 assistant 消息
for (let i = messages.length - 1; i >= 0; i--) {
  const msg = messages[i];
  if (msg.role === "assistant" && Array.isArray(msg.content) && msg.content.length === 0) {
    messages.splice(i, 1);
  }
}

// Step 7: 删除空 assistant 后可能产生连续同角色消息，再合并一次
mergeConsecutive(messages, "user");
mergeConsecutive(messages, "assistant");
```

**注意**：此步骤在 `patchMissingThinkingBlocks` **之后**执行。因为 thinking 补丁会给空的 assistant 补上 thinking block，此时 content 不为空，不会被错误移除。执行顺序很重要：

```
patchMissingThinkingBlocks → 补 thinking block（空 assistant 变为 [thinking]）
patchOrphanToolResults → 清理孤儿 → 移除真正为空的 assistant
```

### 4.7 步骤 6：thinking block 位置修正

**目标**：防御性检查，确保 thinking block 始终在 assistant content 数组第一位。

**修改文件**：`src/proxy/patch/deepseek/patch-thinking-blocks.ts`

```typescript
for (const msg of messages) {
  if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
  const blocks = msg.content as Array<Record<string, unknown>>;

  const thinkingIdx = blocks.findIndex(
    (b) => b && typeof b === "object" && b.type === "thinking",
  );

  if (thinkingIdx === -1) {
    // 不存在 thinking block → 补一个
    const emptyThinking: Record<string, unknown> = { type: "thinking", thinking: "" };
    if (needsSignature) emptyThinking.signature = "";
    blocks.unshift(emptyThinking);
  } else if (thinkingIdx > 0) {
    // thinking block 不在第一位 → 移到首位
    const [thinkingBlock] = blocks.splice(thinkingIdx, 1);
    blocks.unshift(thinkingBlock);
  }
}
```

### 4.8 步骤 7：tool_use 合并去重

**目标**：连续 assistant 消息合并时，按 tool_use id 去重。

**修改文件**：`src/proxy/patch/deepseek/patch-orphan-tool-results.ts`

```typescript
function mergeConsecutive(
  messages: Array<{ role: string; content: unknown }>,
  role: string,
): void {
  let i = 1;
  while (i < messages.length) {
    if (messages[i].role === role && messages[i - 1].role === role) {
      const prev = messages[i - 1];
      const curr = messages[i];
      const prevContent = normalizeToArray(prev.content);
      const currContent = normalizeToArray(curr.content);

      if (role === "assistant") {
        // assistant 合并时按 tool_use id 去重
        prev.content = mergeAssistantContent(prevContent, currContent);
      } else {
        prev.content = [...prevContent, ...currContent];
      }
      messages.splice(i, 1);
    } else {
      i++;
    }
  }
}

function mergeAssistantContent(prev: ContentBlock[], curr: ContentBlock[]): ContentBlock[] {
  const seenToolIds = new Set<string>();
  for (const b of prev) {
    if (b?.type === "tool_use" && typeof b.id === "string") {
      seenToolIds.add(b.id);
    }
  }
  const deduped = curr.filter(b =>
    !(b?.type === "tool_use" && typeof b.id === "string" && seenToolIds.has(b.id)),
  );
  return [...prev, ...deduped];
}
```

### 4.9 步骤 8：提取共享工具函数

**目标**：消除 `patch-orphan-tool-results.ts` 和 `router-cleanup.ts` 之间的代码重复（`mergeConsecutive`、`normalizeToArray`）。

**新增文件**：`src/proxy/patch/deepseek/utils.ts`

```typescript
export type ContentBlock = Record<string, unknown>;
export type Message = { role: string; content: unknown };

export function normalizeToArray(content: unknown): ContentBlock[] {
  if (Array.isArray(content)) return content as ContentBlock[];
  if (typeof content === "string") return [{ type: "text", text: content }];
  return [{ type: "text", text: String(content ?? "") }];
}

export function mergeConsecutive(
  messages: Message[],
  role: string,
  mergeAssistant?: (prev: ContentBlock[], curr: ContentBlock[]) => ContentBlock[],
): void {
  let i = 1;
  while (i < messages.length) {
    if (messages[i].role === role && messages[i - 1].role === role) {
      const prev = messages[i - 1];
      const curr = messages[i];
      const prevContent = normalizeToArray(prev.content);
      const currContent = normalizeToArray(curr.content);
      if (role === "assistant" && mergeAssistant) {
        prev.content = mergeAssistant(prevContent, currContent);
      } else {
        prev.content = [...prevContent, ...currContent];
      }
      messages.splice(i, 1);
    } else {
      i++;
    }
  }
}
```

**后续重构**：`patch-orphan-tool-results.ts` 和 `router-cleanup.ts` 都改为 import 这些共享函数。

### 4.10 步骤 9：补充测试

**新增测试覆盖**：

| 测试场景 | 覆盖步骤 |
|---------|---------|
| `stripCacheControl` 移除 messages/system/tools 中的 cache_control | 步骤 2 |
| `stripCacheControl` 无 cache_control 时不修改 | 步骤 2 |
| `patchThinkingParam` Anthropic 注入含 budget_tokens | 步骤 3 |
| `patchThinkingParam` OpenAI 注入不含 budget_tokens | 步骤 3 |
| `patchThinkingParam` 已有参数时不覆盖 | 步骤 3 |
| thinking block `signature` 检测 — 有 signature 的历史 | 步骤 4 |
| thinking block `signature` 检测 — 无 signature 的历史 | 步骤 4 |
| 空 assistant 清理 — 孤儿清理后残留空 content | 步骤 5 |
| 空 assistant 清理 — 只剩 thinking block 时不移除 | 步骤 5 |
| thinking block 位置修正 — 在第二位时移到首位 | 步骤 6 |
| tool_use 合并去重 — 相同 id 的 tool_use 只保留一个 | 步骤 7 |
| `applyProviderPatches` 传入 api_type 后正确分发 | 步骤 1 |

### 4.11 最终的 Anthropic Patch 执行顺序

```
applyDeepSeekPatches(body, "anthropic")
  → patchThinkingParam(body, "anthropic")     // P1: 自动注入 thinking 参数
  → stripCacheControl(body)                    // P1: 剥离 cache_control
  → patchMissingThinkingBlocks(body)           // P0: 补 thinking block + signature 检测 + 位置修正
  → patchOrphanToolResults(body)               // P1: 清理孤儿 + 空 assistant 清理 + 去重
```

**顺序依赖说明**：
1. `patchThinkingParam` 必须最先执行 — 后续 patch 可能依赖 `body.thinking` 存在
2. `stripCacheControl` 在消息修改之前执行 — 避免后续修改引入新的 cache_control（不会）
3. `patchMissingThinkingBlocks` 在 orphan 清理之前 — 给空 assistant 补 thinking block，防止被清理掉
4. `patchOrphanToolResults` 最后执行 — 因为它可能删除消息、合并消息，需要在其他 patch 稳定消息结构后执行

### 4.12 最终文件结构

```
src/proxy/patch/
├── index.ts                              # 修改：ProviderInfo 增加 api_type
├── router-cleanup.ts                     # 重构：使用共享 utils
└── deepseek/
    ├── index.ts                          # 修改：接收 apiType，分发 Anthropic/OpenAI patch
    ├── utils.ts                          # 新增：共享 normalizeToArray, mergeConsecutive
    ├── patch-thinking-param.ts           # 新增：自动注入 thinking 参数
    ├── patch-cache-control.ts            # 新增：剥离 cache_control
    ├── patch-thinking-blocks.ts          # 修改：signature 检测 + 位置修正
    └── patch-orphan-tool-results.ts      # 修改：空 assistant 清理 + 去重 + 共享 utils
```

---

## 5. 附录

### 5.1 实验记录

全部实验脚本和结果在 `router/scripts/test-deepseek-patch.mjs`，关键实验结论：

- Signature 是 UUID 格式，非加密签名，DeepSeek 不验证真实值
- `redacted_thinking` 不被 DeepSeek 支持
- 纯文本 assistant 消息不强制要求 thinking 块
- tool_use 消息在 thinking 模式激活时**必须**有 thinking 块
- 一旦去掉 `body.thinking`，后续恢复 thinking 时历史 tool_use 仍触发校验（持久化问题）
- 将 tool_use/tool_result 转为 text 后 DeepSeek 一切正常，且可继续发起新工具调用

### 5.2 关联参考

- Pi `compat` 配置体系：`@mariozechner/pi-coding-agent` 的 `compat` 模块
- 原始补丁 commit：`3e59744`
- 实验脚本：`router/scripts/test-deepseek-patch.mjs`

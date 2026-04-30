# DeepSeek Patch 优化设计

> 日期：2026-04-30
> 分支：feat-deepseek-compat
> 关联：参考 Pi (`@mariozechner/pi-coding-agent`) 的 `compat` 配置体系

## 目录

- [1. 背景](#1-背景)
- [2. 现状分析](#2-现状分析)
- [3. OpenAI 协议优化项](#3-openai-协议优化项)
- [4. Anthropic 协议优化项](#4-anthropic-协议优化项)
- [5. Anthropic 优化执行计划](#5-anthropic-优化执行计划)

---

## 1. 背景

### 1.1 Pi 的 compat 体系

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

### 1.2 我们的区别

我们是 **API 代理路由器**，不是客户端。需要同时处理：
- **请求方向**：客户端 → 代理 → DeepSeek（请求体 patch）
- **双协议**：OpenAI `/v1/chat/completions` 和 Anthropic `/v1/messages` 两条路径
- **代理特有问题**：历史消息截断导致孤儿 tool_result、多客户端消息格式差异

### 1.3 当前 Patch 架构

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

---

## 2. 现状分析

### 2.1 调用链

```
proxy-handler.ts: handleProxyRequest()
  → applyProviderPatches(currentBody, provider)   // provider 含 api_type 但被忽略
    → needsDeepSeekPatch(body, provider)           // 仅检测 base_url 和 model 名
      → applyDeepSeekPatches(body)                 // 不接收 apiType
        → patchMissingThinkingBlocks(body)          // 只处理 Anthropic content block 格式
        → patchOrphanToolResults(body)              // 只处理 Anthropic tool_use/tool_result 格式
```

### 2.2 当前 Patch 能力矩阵

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

---

## 3. OpenAI 协议优化项

> 客户端通过 `/v1/chat/completions` → DeepSeek API

### 3.1 [P0] 补 `reasoning_content: ""` 字段

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

### 3.2 [P1] `reasoning_effort` 映射

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

### 3.3 [P1] 自动注入 `thinking` 参数

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

### 3.4 [P2] assistant content string 化

**问题**：部分非官方端点（如 NVIDIA NIM 托管的 DeepSeek）会把 `[{type:"text", text:"..."}]` 原样回显，产生递归嵌套。

**Pi 的做法**：始终将 assistant content 作为 string 发送，而非 content block 数组。

**影响范围**：仅限非官方端点，直连 `api.deepseek.com` 不受影响。优先级低。

---

## 4. Anthropic 协议优化项

> 客户端通过 `/v1/messages` → DeepSeek Anthropic 兼容端点

### 4.1 [P0] `signature` 字段一致性

**问题**：当前补丁注入 `{ type: "thinking", thinking: "", signature: "" }`。标准 Anthropic 的 thinking block 有加密 `signature` 字段用于验证完整性。DeepSeek 的 Anthropic 兼容 API 对 `signature` 的处理可能不一致——传空字符串在某些版本下可能触发校验错误。

**改进**：检测历史中 thinking block 是否带 `signature` 字段，仅在必要时补入。

### 4.2 [P1] 自动注入 `thinking` 参数

**问题**：Anthropic 格式要求 `thinking: { type: "enabled", budget_tokens: N }`。客户端后续请求可能不传，但历史中有 thinking block，导致 DeepSeek 行为不可预测。

### 4.3 [P1] `cache_control` 剥离

**问题**：Claude Code 等客户端会在 content block 上标注 `cache_control: { type: "ephemeral" }`。DeepSeek 不支持 Anthropic 的 `cache_control`，会报 `unexpected field` 错误。当前完全透传，未做剥离。

### 4.4 [P1] 空 assistant 消息清理

**问题**：`patchOrphanToolResults` 清理孤儿后，可能出现 assistant 消息所有 tool_use 被移除（因对应的 tool_result 也是孤儿），只剩空 content 数组 `[]`。Anthropic 协议要求 assistant 消息必须有内容。

### 4.5 [P2] thinking block 位置校验

**问题**：Anthropic 协议要求 thinking block 是 assistant content 的第一个元素。当前用 `unshift` 保证插入位置正确，但不处理历史中 thinking block 不在首位的情况。

### 4.6 [P2] tool_use 合并去重

**问题**：连续 assistant 消息合并时，可能出现重复 tool_use id。需在合并时去重。

---

## 5. Anthropic 优化执行计划

### 5.1 总览

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

### 5.2 步骤 1：架构改造 — apiType 感知

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

---

### 5.3 步骤 2：`cache_control` 剥离

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

---

### 5.4 步骤 3：`thinking` 参数自动注入

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

---

### 5.5 步骤 4：`signature` 字段一致性

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

**验证**：现有测试的 `toEqual({ type: "thinking", thinking: "", signature: "" })` 在默认场景（有 thinking block 在历史中）下行为不变。新增一个不带 signature 的测试用例。

---

### 5.6 步骤 5：空 assistant 消息清理

**目标**：orphan 清理后，移除 content 为空的 assistant 消息，避免 DeepSeek 校验失败。

**修改文件**：`src/proxy/patch/deepseek/patch-orphan-tool-results.ts`

**修改范围**：在函数末尾（Step 5 之后）追加 Step 6 和 Step 7。

```typescript
// 在现有 Step 5 (mergeConsecutive assistant) 之后添加：

// Step 6: 移除 content 为空数组的 assistant 消息
// 经过孤儿清理后，assistant 可能只剩下 thinking block（无 text 也无 tool_use），
// 或者完全为空。如果只有 thinking block，保留（DeepSeek 要求）。
// 只有 content 完全为空时才移除。
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

---

### 5.7 步骤 6：thinking block 位置修正

**目标**：防御性检查，确保 thinking block 始终在 assistant content 数组第一位。

**修改文件**：`src/proxy/patch/deepseek/patch-thinking-blocks.ts`

**修改范围**：在现有的 "检测 hasThinking" 循环中，增加位置修正逻辑。

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

---

### 5.8 步骤 7：tool_use 合并去重

**目标**：连续 assistant 消息合并时，按 tool_use id 去重。

**修改文件**：`src/proxy/patch/deepseek/patch-orphan-tool-results.ts`

**修改范围**：`mergeConsecutive` 函数对 assistant 角色的处理。

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

---

### 5.9 步骤 8：提取共享工具函数

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

---

### 5.10 步骤 9：补充测试

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

---

### 5.11 最终的 Anthropic Patch 执行顺序

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

---

### 5.12 文件结构（改动后）

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

# DeepSeek Anthropic API 跨模型切换问题调研

## 1. 问题现象

同一 agent 会话中，先使用其他模型（如 GLM）进行对话，然后切换到 DeepSeek（Anthropic API 端点），切换后 DeepSeek 返回 400 错误：

```
The `content[].thinking` in the thinking mode must be passed back to the API.
```

后续在 DeepSeek 上进行工具调用时，出现**工具调用无限循环**——同一个工具被反复调用，无法停止。

## 2. 问题根因

### 2.1 DeepSeek Anthropic API 的 thinking 校验规则

通过实验验证（`scripts/test-deepseek-patch.mjs`），DeepSeek 对历史消息中 thinking 块的校验规则是：

| 场景 | 结果 |
|------|------|
| thinking enabled，纯文本 assistant 缺 thinking | ✅ 200，**不强制要求** |
| thinking enabled，含 tool_use 的 assistant 缺 thinking | ❌ 400，**强制要求** |
| thinking enabled，含 tool_use 且 thinking.signature 为空 | ❌ 400 |
| thinking disabled（不传 body.thinking），含 tool_use 缺 thinking | ✅ 200 |

核心结论：**只有在 thinking 模式激活时，含 tool_use 的 assistant 消息才强制要求携带 thinking 块。**

### 2.2 signature 字段的本质

通过多轮 API 调用观察，DeepSeek 的 `signature` 字段是 UUID v4 格式（如 `3efe47c9-054d-4f18-9485-7793a6d61525`），**不是加密签名**。每次请求的 signature 都不同，DeepSeek 只验证字段存在且非空，不验证值的真实性。全零 UUID `00000000-0000-0000-0000-000000000000` 和随机 UUID 均通过校验。

### 2.3 无限循环的机制

原补丁插入 `{type: "thinking", thinking: "", signature: ""}`（空签名），DeepSeek 将其视为"thinking 链断裂"，**忽略该消息中的 tool_use 块**。模型认为该工具调用"没发生过"，于是重新生成同样的 tool_use → 结果返回后补丁再次插入空 thinking → 模型再次忽略 → 循环。

## 3. 之前的处理方式

### 3.1 原始补丁（commit `3e59744`）

在 `src/proxy/proxy-handler.ts` 中直接内联函数 `patchMissingThinkingBlocks`，扫描所有 assistant 消息，对缺少 thinking 块的插入：

```typescript
msg.content.unshift({ type: "thinking", thinking: "", signature: "" });
```

后来重构到独立模块 `src/proxy/patch/deepseek/patch-thinking-blocks.ts`，并增加了 `patchOrphanToolResults` 处理上下文截断产生的孤儿 tool_result。

### 3.2 第一次修复尝试（当前分支已有改动）

在 `patchMissingThinkingBlocks` 中增加判断：含 tool_use 的消息跳过不修补。

**问题**：这个修复方向是错的——测试证明含 tool_use 的消息**必须**有 thinking 块，跳过会导致 400 错误。

## 4. 实验过的方案

### 4.1 方案矩阵

| # | 方案 | 校验结果 | 工具调用 | 备注 |
|---|------|---------|---------|------|
| 1 | 空 thinking `{thinking:"",signature:""}` + tool_use | ✅ 200 | ❌ 无限循环 | 最初方案 |
| 2 | 跳过 tool_use（不修补） | ❌ 400 | — | 校验失败 |
| 3 | `redacted_thinking` 替代 thinking | ❌ 400 | — | DeepSeek 不支持此类型 |
| 4 | 复制相邻消息的 signature `{thinking:"",signature:"COPIED"}` | ✅ 200 | ❌ 隐患同上 | 签名与内容不匹配 |
| 5 | 自生成 UUID `{thinking:"",signature:crypto.randomUUID()}` | ✅ 200 | ❌ 隐患同上 | thinking 内容仍为空 |
| 6 | 剥离 history 中所有 thinking + 删除 `body.thinking` | ✅ 200 | ✅ 正常 | 但**永久无法恢复 thinking** |
| 7 | 非 DeepSeek 的 tool_use/tool_result → text（**选定方案**） | ✅ 200 | ✅ 正常 | 信息保留，自愈 |

### 4.2 各方案详细分析

#### 方案 2：跳过 tool_use（当前分支的修复）

纯文本消息不加 thinking（DeepSeek 不要求），含 tool_use 的消息跳过。

- **致命缺陷**：DeepSeek 对含 tool_use 的消息**强制要求** thinking 块。跳过会导致 400。
- 此方案在前期的探索中被否决。

#### 方案 3：`redacted_thinking`

Anthropic API 原生支持的 `RedactedThinkingBlock {type:"redacted_thinking", data:""}`，不需要 signature 字段。

- **致命缺陷**：DeepSeek 的 Anthropic 兼容实现不完整，返回 400: `unknown variant 'redacted_thinking'`。

#### 方案 6：剥离所有 thinking + 删除 `body.thinking`

检测到历史不一致时清空所有 thinking 块，不传 `body.thinking`。

- **致命缺陷**：一旦执行降级，后续请求**永久无法恢复 thinking 模式**。因为被转换的 tool_use 消息仍在历史中，再次开启 `body.thinking` 时校验立即触发。

#### 方案 5 vs 方案 7：UUID 修补 vs tool_use→text

两者都能通过校验。但方案 5（自生成 UUID）仍然伪造了 thinking 块，空内容可能对模型理解产生微妙影响。方案 7 完全避免伪造，将 tool_use 降级为自然语言格式。

## 5. 最终方案：tool_use/tool_result → text

### 5.1 核心思路

**不修补（伪造），而是降级（格式转换）。** 将非 DeepSeek 生成的消息中的 `tool_use`/`tool_result` 转为 text 块，从格式层面规避校验，同时完整保留工具调用信息。

### 5.2 判断标准

"非 DeepSeek 生成"的 assistant 消息：
- content 数组中有 `tool_use` 块，且
- 无 `thinking` 块，或 `thinking.signature` 为空/缺失

### 5.3 转换示例

```
补丁前（GLM 历史）:
  assistant [{tool_use: read, id: call_1}]
  user      [{tool_result: call_1, content: "file content"}]

补丁后:
  assistant [{text: '{"type":"tool_use","id":"call_1","name":"read",...}'}]
  user      [{text: '{"type":"tool_result","tool_use_id":"call_1",...}'}]
```

DeepSeek 原生消息（有合法 thinking + signature）保留不动。

### 5.4 为什么选择这个方案

1. **不伪造内容**：不生成任何假 thinking/signature，语义正确
2. **信息完整保留**：tool_use/tool_result 通过 JSON 序列化保留全部字段
3. **一次性修复 + 自愈**：只需首轮转换非 DeepSeek 消息，后续 DeepSeek 回复自带合法 thinking，补丁自动退出
4. **工具调用正常**：降级为 text 后不影响 DeepSeek 继续发起新工具调用（实测验证）
5. **无永久退化**：不同于"剥离 thinking"方案，DeepSeek 原生消息保留完整，thinking 能力不丢失

### 5.5 与 patchOrphanToolResults 的关系

执行顺序不变：
1. `patchNonDeepSeekToolMessages` — 将非 DeepSeek 的 tool_use/tool_result 转为 text
2. `patchOrphanToolResults` — 处理 DeepSeek 原生消息中因 Claude Code 上下文截断产生的孤儿 tool_result

两者协同：补丁 1 降低了补丁 2 需要处理的范围（非 DeepSeek 的消息已转为 text，不会被误判）。

## 6. 同类开源项目调研

| 项目 | 处理方式 |
|------|---------|
| **litellm** | 检测到不一致时**删除 body.thinking 参数**降级（放弃本轮思考），不做消息修补 |
| **langchain** | 请求路径中**静默剥离** reasoning/thinking 块，完全不处理跨模型兼容 |
| **octopus** | 有完整的 Anthropic↔OpenAI 格式转换器，但不做消息历史修补 |

三个项目均未处理"跨模型切换时为 tool_use 消息补 thinking 块"这一场景。本项目的方案 B（tool_use→text）是该问题的独有解决方案。

## 7. 实验记录

全部实验脚本和结果在 `scripts/test-deepseek-patch.mjs`，关键实验结论：

- Signature 是 UUID 格式，非加密签名，DeepSeek 不验证真实值
- `redacted_thinking` 不被 DeepSeek 支持
- 纯文本 assistant 消息不强制要求 thinking 块
- tool_use 消息在 thinking 模式激活时**必须**有 thinking 块
- 一旦去掉 `body.thinking`，后续恢复 thinking 时历史 tool_use 仍触发校验（持久化问题）
- 将 tool_use/tool_result 转为 text 后 DeepSeek 一切正常，且可继续发起新工具调用

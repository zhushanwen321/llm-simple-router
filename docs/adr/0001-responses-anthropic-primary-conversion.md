# ADR 0001: Responses ↔ Anthropic 一级转换 + Chat 二级桥接

新增 OpenAI Responses API 支持时，采用 Responses ↔ Anthropic 作为一级转换（近无损），Chat Completions 通过二级桥接接入（有损降级）。核心依据是 Responses API 和 Anthropic Messages 在结构上最近亲——顶层系统提示、类型化输出数组、命名 SSE 事件、结构化推理输出——而 Chat Completions 在这些维度都是异类，桥接必然丢失 thinking signature、response_format 等信息。

## 转换拓扑

```
Responses API ←→ Anthropic Messages     （一级转换，近无损）
       ↑
Chat Completions ──────────────────────  （二级桥接，有损降级）
```

## 转换优先级矩阵

| 客户端格式 \ 上游格式 | Responses | Anthropic | Chat |
|---|---|---|---|
| Responses | 直通 | Responses → Anthropic（一级） | Responses → Chat（桥接） |
| Anthropic | Anthropic → Responses（一级） | 直通 | Anthropic → Chat（保留现有直连） |
| Chat | Chat → Responses（桥接） | Chat → Anthropic（保留现有直连） | 直通 |

## 结构相似性（决策依据）

Responses API 和 Anthropic Messages 在五个维度结构近亲，Chat Completions 是异类：

| 维度 | Responses ↔ Anthropic | Chat ↔ 任一 |
|---|---|---|
| 系统提示 | 都是顶层字段（`instructions` ↔ `system`） | Chat 嵌在 messages 数组中 |
| 输出结构 | 都是类型化 items/blocks 数组 | Chat 是扁平 choices[].message.content |
| 流式 | 都是命名事件（`event:` + `data:`） | Chat 是匿名 `data:` 行 |
| 推理输出 | 都是结构化（`reasoning` ↔ `thinking`） | Chat 是扁平字符串，丢失 signature |
| 工具调用 | 独立类型化单元 | 嵌在 choice.message.tool_calls[] |

信息保真度：Responses ↔ Anthropic 接近无损（thinking signature、cache_control、结构化输出都能保留）；Chat ↔ 任一有损（thinking signature 丢失、response_format 无法表达、内置工具无法映射）。

长远看，OpenAI 方向是 Responses API，新特性（MCP、内置工具、background 模式）只在 Responses 中可用，一级转换路径随生态演进越来越重要。

## Considered Options

1. **对称三方转换**：三种格式两两直接转换，共 6 条路径。信息保真度最高但维护成本线性增长，每新增一种格式增加 N 条转换路径。
2. **以 Chat 为中心**：所有格式先转 Chat 再转目标格式。实现最简但 Chat 是信息最贫乏的格式，所有转换都有损。
3. **选定方案**：Responses ↔ Anthropic 一级 + Chat 桥接。兼顾保真度和维护成本。

## 实现策略

- 保留现有 `Anthropic ↔ Chat` 转换代码不动，作为高频路径优化。
- 新增 `Responses ↔ Anthropic` 一级转换：`instructions↔system`、`input items↔messages`、`function_call↔tool_use`、`output items↔content blocks`、`reasoning↔thinking`、命名 SSE 事件双向映射。
- 新增 `Responses ↔ Chat` 二级桥接：`instructions→system message`、`output items→choices`、`reasoning→reasoning_content`（扁平化）、命名事件 ↔ 匿名 delta 转换。
- `api_type` 从 `"openai" | "anthropic"` 扩展为 `"openai" | "openai-responses" | "anthropic"`。`"openai"` = Chat Completions 兼容（智谱/Moonshot 等），`"openai-responses"` = Responses API（OpenAI 官方、Codex CLI），`"anthropic"` = Anthropic Messages（Claude Code）。

## Consequences

- Anthropic → Chat 不走双重转换（不经过 Responses），保留现有直连优化路径。
- 现有 Anthropic ↔ Chat 转换代码保留不动，新增代码不破坏已有路径。
- Chat ↔ Responses/Anthropic 的桥接路径是有损的，thinking signature、内置工具等特性无法在 Chat 格式中表达。
- 转换路径增多带来维护复杂度，需确保一级转换（核心路径）质量高于桥接路径。
- Responses API 变更风险：需紧跟 OpenAI SDK 版本保持兼容。

# 架构决策：Responses ↔ Anthropic 一级转换 + Chat 桥接

> 决策日期：2026-05-02

## 决策

新增 OpenAI Responses API 支持时，采用 **Responses ↔ Anthropic 一级转换 + Chat 二级桥接** 的架构。

## 转换拓扑

```
              Responses API ←→ Anthropic Messages
              (一级转换，近无损)          
                    ↑                    
                    |                    
         Chat Completions ──────────────
         (二级桥接，有损降级)    (保留直连优化路径)
```

## 转换优先级矩阵

| 客户端格式 | → 上游 Responses | → 上游 Anthropic | → 上游 Chat |
|-----------|-----------------|-----------------|------------|
| **Responses** | 直通 | Responses → Anthropic（一级） | Responses → Chat（桥接） |
| **Anthropic** | Anthropic → Responses（一级） | 直通 | Anthropic → Chat（保留现有直连） |
| **Chat** | Chat → Responses（桥接） | Chat → Anthropic（保留现有直连） | 直通 |

## 核心理由

### 1. 结构相似性

Responses API 和 Anthropic Messages 在结构上最近亲，Chat Completions 是异类：

| 维度 | Responses ↔ Anthropic | Chat ↔ 任一 |
|------|----------------------|------------|
| 系统提示 | 都是顶层字段（`instructions` ↔ `system`） | Chat 嵌在 messages 数组中 |
| 输出结构 | 都是类型化 items/blocks 数组 | Chat 是扁平 choices[].message.content |
| 流式 | 都是命名事件（`event:` + `data:`） | Chat 是匿名 `data:` 行 |
| 推理输出 | 都是结构化（`reasoning` ↔ `thinking`） | Chat 是扁平字符串，丢失 signature |
| 工具调用 | 独立类型化单元 | 嵌在 choice.message.tool_calls[] |

### 2. 信息保真度

- **Responses ↔ Anthropic**：接近无损。thinking signature、cache_control、结构化输出都能保留
- **Chat ↔ 任一**：有损。thinking signature 丢失、response_format 无法表达、内置工具无法映射

### 3. 长远兼容性

- OpenAI 方向是 Responses API（Chat Completions 不会立即废弃但不再是重点）
- 更多 Provider 会逐步支持 Responses API
- 新特性（MCP、内置工具、background 模式）只在 Responses 中可用
- 一级转换路径随生态演进而越来越重要

## 实现策略

### 保留现有代码

- `Anthropic ↔ Chat` 的现有转换代码保留不动，作为高频路径优化
- 现有的 `TransformCoordinator` 扩展而非重写

### 新增一级转换

- `Responses ↔ Anthropic`：新写，核心投入
- 请求转换：`instructions↔system`、`input items↔messages`、`function_call↔tool_use`
- 响应转换：`output items↔content blocks`、`reasoning↔thinking`
- 流式转换：命名事件双向映射

### 新增二级桥接

- `Responses ↔ Chat`：桥接代码
- 请求：`instructions→system message`、`input items→messages`、`function_call→tool_calls`
- 响应：`output items→choices`、`reasoning→reasoning_content`（扁平化）
- 流式：命名事件 ↔ 匿名 delta 转换

### api_type 扩展

Provider 和客户端的 `api_type` 从 `"openai" | "anthropic"` 扩展为：

```typescript
type ApiType = "openai" | "openai-responses" | "anthropic";
```

- `"openai"` = OpenAI Chat Completions 兼容（智谱/Moonshot 等）
- `"openai-responses"` = OpenAI Responses API（OpenAI 官方、Codex CLI）
- `"anthropic"` = Anthropic Messages（Claude Code）

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 转换路径增多，维护复杂 | 一级转换是核心，桥接可简化 |
| Anthropic → Chat 双重转换 | 保留现有直连路径 |
| Responses API 变更 | 紧跟 OpenAI SDK 版本，保持兼容 |

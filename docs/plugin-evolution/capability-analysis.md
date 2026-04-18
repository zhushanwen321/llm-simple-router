# 后端代理插件的核心能力分析

## 三个核心能力

代理增强的本质是 intercept → process → forward。其中 "process" 分解为三个可复用能力：

| 能力 | 职责 | 现有实现 |
|------|------|---------|
| 指令解析 | 从用户消息中提取结构化命令 | `directive-parser.ts` — 解析 `$SELECT-MODEL`、`[router-model:]`、`[router-command:]` |
| 会话状态 | 跨请求持久化的 key-value 存储 | `model-state.ts` — 内存 + DB 双写，24h TTL |
| 消息变换 | 对请求/响应体的结构化修改 | `response-cleaner.ts` + `enhancement-handler.ts` 中的模型替换 |

**核心判断**：不同 AI 工具（Claude Code、Cursor、Aider）的差异主要体现在解析逻辑层面——指令格式、消息体结构、会话标识方式不同。但底层能力模型是相同的。这三个能力覆盖了约 80% 的实际增强场景。

## 未覆盖的边界场景

### 流式处理（Streaming）

三个能力隐含"request/response 是完整消息体"的假设。流式场景下响应是逐 chunk 发送的 SSE 流，"消息变换"无法表达。当前的 `buildModelInfoTag` 只在非流式时注入，不是偶然——是能力模型的内在限制。

未来如果需要"实时过滤 SSE chunk 中的敏感词"这类增强，需要新增一种 chunk-level 的处理能力。

### 多步编排

三个能力假设单次 request → 单次 response 流程。但"先发给便宜模型做分类，再路由到不同模型"这类场景需要在一个用户请求中发起多次上游调用。当前 beforeProxy/intercept/afterResponse 模型无法支撑。

### 路由控制

当前插件只能改 `model` 字段间接影响路由。但"特定 provider 走特定超时"或"绕过 failover 直接指定 provider"这类需求，单纯改 model 字段不够，需要影响 proxy-core 的 failover/retry 行为。

## "不同工具只是解析逻辑不同"需要修正

差异不止是解析。消息结构（Anthropic content blocks 数组 vs OpenAI 字符串）、会话模型（有/无 session）、指令注入位置（消息文本 / system prompt / CLI 参数）都是结构性差异。特别是"会话"这个概念——有些工具根本没有，因此状态管理不能默认绑定到 session，需要支持多种作用域：session / api-key / global / time-window。

## 分析本身的盲区

- **"消息变换"太粗**：请求变换（有完整控制权）和响应变换（流式下无法修改）语义不同，统称为"消息变换"会掩盖不对称性
- **插件间冲突**：两个增强同时改 model 字段或注册同一指令时的优先级/冲突检测未考虑
- **能力发现**：用户如何知道当前有哪些可用指令（如 `$HELP`）未设计
- **无状态增强**：内容过滤器只需要消息变换，审计日志只需要 afterResponse 观察——框架应允许只声明需要的能力

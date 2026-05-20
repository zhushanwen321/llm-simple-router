# LLM Simple Router

LLM API 代理路由器的领域术语表。定义系统管理的核心概念及其关系，供开发者和 AI 理解系统在说什么。

## 核心路由

**Client Model（客户端模型）**:
客户端调用 Router 时使用的模型名（如 `sonnet`、`opus`）。Router 通过映射组将其转换为 Target Model。系统通过映射组管理 Client Model 的路由规则。
_Avoid_: 请求模型、输入模型

**Target（目标）**:
一个 **Provider** + 一个目标模型的组合，是映射解析的输出，也是最终调用上游 API 时使用的模型和端点。管理员在映射组 UI 上配置的每一行就是一个 Target。
_Avoid_: 后端模型（单独使用时）、目标端点

**Provider（供应商端点）**:
一个 API 端点及其凭证（base_url + api_key）。同一个 LLM 供应商（如智谱）如果有多个 API Key，对应多个 Provider。Provider 持有模型列表、并发配置、网络代理等。
_Avoid_: 供应商（过于笼统）、后端

**Model（模型）**:
Provider 的附属属性，拥有元数据（capabilities、context_window 等）。模型元数据有四个来源层级：用户手动配置 > 内置白名单 > 外部模型目录 > 默认值。同一个模型名可以出现在多个 Provider 下，但每个 Provider 各自管理自己的模型列表。
_Avoid_: 模型实例

**Mapping Group（映射组）**:
将一个 **Client Model** 映射为一组 **Target** 的规则容器。包含映射策略和可选的分时段规则。每个 Client Model 唯一对应一个映射组（1:1）。
_Avoid_: 映射规则、路由表

**Mapping Strategy（映射策略）**:
映射组内从多个 Target 中选择一个的方式。当前有效策略为 scheduled（定时，推荐），round-robin 和 random 已废弃。
_Avoid_: 路由策略

**Schedule（分时段规则）**:
映射组下的时间窗口规则，每个时段可配置独立的 Target 列表和并发上限。一个映射组可有多个 Schedule，按时间匹配，命中的 Schedule 覆盖映射组的默认 Target。
_Avoid_: 时间规则

## 认证与访问控制

**Router Key（路由密钥）**:
客户端认证用的 API 密钥（格式 `sk-router-xxx`），SHA256 哈希后存储。可选配置 `allowed_models` 字段，限制该密钥只能访问特定的 **Client Model**，不配置则允许所有。
_Avoid_: API Key（混淆上游 Provider 的 key）、Token

## 失败恢复

**Retry（重试）**:
同一个 **Target** 上，按 **Retry Rule** 配置的状态码和错误模式匹配后自动重试，支持 fixed 和 exponential 退避策略。管理员通过 Retry Rule 配置重试行为。
_Avoid_: 自动重试（笼统用法）

**Failover（故障转移）**:
排除失败的 **Target**，回到 **Mapping Group** 重新解析，选择下一个可用 Target。Failover 是映射策略层面行为，与 Retry 独立——可以只配重试不配故障转移，反之亦然。
_Avoid_: 自动切换（笼统用法）、故障转移策略

**Retry Rule（重试规则）**:
管理员配置的实体，定义匹配条件（HTTP 状态码 + 响应体正则）和重试策略（退避方式、最大次数）。绑定到 Provider 维度。
_Avoid_: 重试配置

## 自动重定向

**Modality Redirect（多模态重定向）**:
当请求包含图片/音频等模态，但当前 Target 的模型不支持该模态时，自动切换到映射组中配置的 fallback 模型。
_Avoid_: 图片重定向、模态切换

**Overflow Redirect（溢出重定向）**:
当请求的 token 数超过当前模型上下文窗口时，自动切换到 Target 上配置的 `overflow_model` + `overflow_provider_id`。
_Avoid_: 上下文溢出、长度重定向

## 可观测性

**Request Log（请求日志）**:
单个请求的四阶段完整链路记录（客户端请求 → 上游请求 → 上游响应 → 客户端响应），只追加不可修改。用于事后排查问题。
_Avoid_: 日志（笼统用法）

**Request Metrics（请求指标）**:
单个请求的量化数据——token 用量（input/output/cache）、TTFT、TPS、stop_reason 等。与 Request Log 通过 request_id 关联，有独立的聚合逻辑（5h 滑动窗口、延迟分位数）。用于成本分析和性能监控。
_Avoid_: 指标（笼统用法）

**Monitor（实时监控）**:
通过 SSE 推送的实时系统状态——活跃请求、队列状态、流式输出内容、延迟统计（p50/p99）。面向实时观察，与 Request Log（事后查看）互补。
_Avoid_: 监控页面、实时日志

## 增强功能

**Proxy Enhancement（代理增强）**:
可选的实验性功能，包括指令解析（`$SELECT-MODEL` 等标记）、会话内模型锁定、工具调用循环检测、token 用量预估、缓存命中率预估。管理员在 UI 上通过开关控制。
_Avoid_: 代理优化、增强代理

**Stream Timeout（流式超时）**:
流式响应的空闲超时配置（`STREAM_TIMEOUT_MS` 环境变量），防止模型卡死不输出导致请求挂起。
_Avoid_: 流超时、SSE 超时

## Flagged Ambiguities

- **"重试"** 在日常用语中常笼统覆盖 Retry 和 Failover 两种行为。CONTEXT 中明确区分：Retry = 同一 Target 重试，Failover = 换 Target。
- **"Provider"** 在日常用语中可指 LLM 供应商（如智谱）或系统中的 Provider 行（端点+凭证）。CONTEXT 中 Provider = 系统管理的实体（一个 API 端点 + 一个凭证）。
- **"模型"** 在不同上下文中可指 Client Model 或 Target Model。讨论时需要明确是入口侧还是出口侧。

## 示例对话

> **Dev**: 用户报告请求 sonnet 模型时被拒绝了，日志里显示 403。
>
> **Domain Expert**: 先查 Router Key 的 allowed_models 是否包含 sonnet 这个 Client Model。如果 allowed_models 为空，说明是别的环节拦截的。
>
> **Dev**: 查了，allowed_models 只配了 opus。那 sonnet 请求确实会被拒。
>
> **Domain Expert**: 对。Client Model 是 sonnet 的请求进来后，先过 Router Key 校验，再到映射组查找 Target。allowed_models 这层就拦住了，根本不会走到映射组。
>
> **Dev**: 另一个问题——用户说请求失败了但没有自动重试。映射组配的是 scheduled 策略，只有一个 Target。
>
> **Domain Expert**: 只有 Target 数量 > 1 时 Failover 才有意义（没别的 Target 可切换）。检查一下 Retry Rule——如果没有配匹配当前错误状态码的规则，Retry 也不会触发。两种恢复机制都不满足，请求就直接失败了。

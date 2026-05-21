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
管理员配置的实体，定义匹配条件（HTTP 状态码 + 响应体匹配）和重试策略（退避方式、最大次数）。支持两种作用域：通用规则（provider_id = NULL，对所有 Provider 生效）和绑定规则（provider_id 指定，仅对该 Provider 生效）。匹配优先级：绑定规则优先，通用规则 fallback。
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

## 响应匹配

**Body Matcher（结构化匹配条件）**:
Retry Rule 中的 JSON 字段匹配配置。每条条件指定 JSON 路径、操作符（equals/contains/exists）和期望值，多条条件之间 AND 关系。配置 Body Matcher 后优先使用结构化匹配，未配置则 fallback 到 body_pattern 正则。解决正则匹配跨 Provider 误命中的问题。
_Avoid_: JSON 匹配、字段匹配

## 增强功能

**Proxy Enhancement（代理增强）**:
可选的实验性功能，包括指令解析（`$SELECT-MODEL` 等标记）、会话内模型锁定、工具调用循环检测、token 用量预估、缓存命中率预估。管理员在 UI 上通过开关控制。
_Avoid_: 代理优化、增强代理

**Stream Timeout（流式超时）**:
流式响应的空闲超时配置（`STREAM_TIMEOUT_MS` 环境变量），防止模型卡死不输出导致请求挂起。
_Avoid_: 流超时、SSE 超时

## 可观测性补充

**Upstream Error Log（上游错误日志）**:
记录最终失败请求（resilience done/abort 且 status >= 400）的错误摘要，包括从上游响应体提取的 error_type 和 error_message。用于事后诊断分析，不用于实时展示。与 Request Log 通过 request_log_id 关联。
_Avoid_: 错误日志（与 Request Log 混淆时）

## LLM API 错误规范

路由器作为 LLM API 代理，返回的错误响应必须与上游 API 的错误格式一致，确保客户端 SDK 能正常解析。新增 `ErrorKind` 和 `errorMeta` 时必须遵循以下规范：

### 错误体格式

**OpenAI 系列**（openai / responses apiType）：
```json
{ "error": { "message": "...", "type": "...", "code": "...", "param": null } }
```

**Anthropic**（anthropic apiType）：
```json
{ "type": "error", "error": { "type": "...", "message": "..." } }
```

注意：Anthropic 没有 `code` 和 `param` 字段。

### HTTP Status + type 映射规则

| 场景分类 | HTTP Status | OpenAI type | Anthropic type |
|---------|------------|-------------|----------------|
| 请求参数/格式错误 | 400 | `invalid_request_error` | `invalid_request_error` |
| 认证失败 | 401 | `authentication_error` | `authentication_error` |
| 权限不足 | 403 | `permission_error` | `permission_error` / `billing_error` |
| 资源不存在 | 404 | `not_found_error` | `not_found_error` |
| 速率限制 | 429 | `rate_limit_error` | `rate_limit_error` |
| 服务端错误 | 500 | `server_error` | `api_error` |
| 上游错误 | 502 | `upstream_error` | `api_error` |
| 服务不可用 | 503 | `server_error` | `api_error` |
| 超时 | 504 | `server_error` | `timeout_error` |

### 新增 ErrorKind 的检查清单

1. 在 `proxy-core.ts` 的 `ErrorKind` 联合类型中添加新值
2. 在 `createErrorFormatter` 中注册 statusCode 和 message
3. 在 `shared-error-meta.ts` 的 `OPENAI_FAMILY_ERROR_META` 中添加 type + code
4. 在 `anthropic.ts` 的 `ANTHROPIC_ERROR_META` 中添加 type + code
5. HTTP Status 选择应与上表一致（客户端错误 4xx，服务端错误 5xx）

### 已知 code 值（自定义，不对应上游官方值）

| code | 用途 |
|------|------|
| `model_not_found` | 映射组中无此 Client Model |
| `model_not_allowed` | Router Key 的 allowed_models 不包含此 Client Model |
| `context_window_exceeded` | 请求 token 超过模型上下文窗口 |
| `unsupported_modality` | 请求包含模型不支持的模态（image/audio） |
| `provider_unavailable` | Provider 不可用 |
| `concurrency_queue_full` | Provider 并发队列已满 |
| `concurrency_timeout` | Provider 并发等待超时 |

## Flagged Ambiguities

- **"重试"** 在日常用语中常笼统覆盖 Retry 和 Failover 两种行为。CONTEXT 中明确区分：Retry = 同一 Target 重试，Failover = 换 Target。
- **"Provider"** 在日常用语中可指 LLM 供应商（如智谱）或系统中的 Provider 行（端点+凭证）。CONTEXT 中 Provider = 系统管理的实体（一个 API 端点 + 一个凭证）。
- **"模型"** 在不同上下文中可指 Client Model 或 Target Model。讨论时需要明确是入口侧还是出口侧。

## 管道架构

**Pipeline Phase（管道阶段）**:
代理请求生命周期中的一个具名执行点，hook 在此挂载。当前定义 6 个阶段：pre_route、post_route、pre_transport、post_response、on_error、on_stream_event。每个阶段内的 hook 按优先级升序执行。
_Avoid_: 钩子阶段、生命周期阶段

**Pipeline Hook（管道钩子）**:
注册到某个 Pipeline Phase 的具名、有优先级的处理函数。内置 hook 命名前缀 `builtin:`，外部插件 hook 命名前缀 `plugin:`。Hook 通过 PipelineContext 与其他 hook 和核心逻辑通信。
_Avoid_: 中间件、拦截器、处理器（单独使用时）

**Pipeline Context（管道上下文）**:
贯穿一次 failover 迭代的可变状态袋。携带 request/reply（不可变）、body/resolved/provider/transportResult（可变）、metadata（hook 间通信通道）。
_Avoid_: 请求上下文（过于笼统）

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

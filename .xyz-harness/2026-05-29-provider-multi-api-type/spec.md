---
verdict: pass
---

# Provider Multi-API-Type Endpoint Support

## Background

当前 Provider 实体绑定单一的 `api_type`（openai/openai-responses/anthropic）+ `base_url` + `api_key`。同一个后端供应商如果同时支持多种协议（如同时提供 OpenAI 兼容和 Anthropic 兼容的 endpoint），需要创建多个 Provider，且客户端请求时协议不匹配会触发格式转换（可能有损）。

用户需要一个 Provider 能配置多个 endpoint，每种 API 类型一个，客户端请求时自动选择匹配的 endpoint，避免不必要的格式转换。同时也支持协议不匹配时走现有 FormatRegistry 格式转换作为降级。

## Functional Requirements

### FR-1: Endpoint 数据模型

Provider 新增 `endpoints` JSON 字段，存储 endpoint 数组作为唯一运行时数据源。

```
ProviderEndpoint {
  api_type: "openai" | "openai-responses" | "anthropic"  // 必填
  base_url: string                                       // 必填
  upstream_path?: string | null                          // 可选，覆盖默认路径
  api_key?: string | null                                // 可选，null = fallback 到共享 key
}
```

约束：
- endpoints 数组至少 1 个元素
- 同一 Provider 内 api_type 不允许重复
- api_key 为 null 时 fallback 到 Provider 级别的 `api_key`（共享兜底 key）
- endpoint 级别的 api_key 使用与 Provider 级别相同的 AES-256-GCM 加密方式存储

### FR-2: 统一 Endpoint 解析

新增 `resolveEndpoint(provider, clientApiType, encryptionKey)` 封装函数，封装所有 endpoint 选择逻辑：

1. 解析 `endpoints` JSON → `ProviderEndpoint[]`
2. 查找 `api_type === clientApiType` 的 endpoint
3. 找到 → 使用该 endpoint，`needsTransform = false`
4. 没找到 → 使用第一个 endpoint，`needsTransform = true`（走现有 FormatRegistry 格式转换）
5. api_key 为 null → fallback 到 `provider.api_key`

返回 `ResolvedEndpoint` 对象：
```
ResolvedEndpoint {
  api_type: string           // 实际上游 api_type
  base_url: string
  upstream_path: string | null
  api_key: string            // 已解密的最终 key
  needs_transform: boolean
}
```

所有消费 provider 的代码（patch 层、plugin 层、transport 层）统一通过此函数获取 base_url/api_type/api_key，不直接读取 provider 的旧字段。

### FR-3: DB 迁移

一次性迁移脚本（migration SQL）：
1. `ALTER TABLE providers ADD COLUMN endpoints TEXT DEFAULT NULL`
2. 遍历所有 provider，将 `{api_type, base_url, upstream_path, api_key}` 组装为 `endpoints: [{...}]` JSON 写入
3. 迁移后 endpoints 永远不为 NULL

旧字段 `api_type`/`base_url`/`upstream_path`/`api_key` 保留在表中但不再作为运行时数据源。

### FR-4: Admin API 变更

Provider CRUD API 直接切换到新格式：

**Create/Update Provider**:
- 请求体包含 `endpoints` 数组（替代原有的单一 `api_type`/`base_url`/`api_key`/`upstream_path`）
- 校验：endpoints 至少 1 个元素、api_type 不重复、base_url 非空
- endpoint 的 api_key 写入前加密（与 provider 级 api_key 同方式）
- 保留 provider 级 `api_key` 字段作为兜底共享 key

**Get Provider**:
- 响应包含 `endpoints` 数组，每个 endpoint 的 api_key 已解密
- 保留旧字段（向后兼容，但标记为 deprecated）

### FR-5: 请求日志增强

`request_logs` 表：
- `api_type` 保持原语义（客户端请求的 API 类型），不变
- 新增 `upstream_api_type TEXT DEFAULT NULL`：实际发送给上游的 api_type
- 新增 `upstream_base_url TEXT DEFAULT NULL`：实际使用的上游 base_url

日志展示页面在请求详情中显示两个字段，方便排查格式转换问题。

### FR-6: 前端 Provider 管理

#### 6a. Provider 列表页

- API Type 列：改为展示多个 Badge（每个 endpoint 一个），单 endpoint 时展示单个 Badge
- API Key 列：多 endpoint 时按行展示，每行显示 `{api_type}: {masked_key}` + 复制按钮

#### 6b. Provider 编辑表单

单 endpoint provider：保持现有 UI 布局（api_type 下拉 + base_url + upstream_path + api_key），保存时序列化为 `[{...}]`。

多 endpoint provider：
- 显示 endpoint 列表，每个 endpoint 有独立的 api_type/base_url/upstream_path/api_key
- 支持添加/删除 endpoint
- "添加 endpoint"按钮带 api_type 选择器（仅显示未配置的 api_type）

#### 6c. 快速配置（QuickSetup）

`useQuickSetup.ts` 的 `buildProviderPayload()` 改为构建 `{endpoints: [{api_type, base_url, ...}]}` 格式。UI 布局不变（用户只配一个 endpoint），但后端 payload 格式变更。

### FR-7: 前端 UI Demo（可选交付物）

在 `docs/design/` 目录下创建前端 UI 变更的 mockup/demo HTML 文件，覆盖：
- Provider 列表页（多 endpoint 展示）
- Provider 编辑表单（多 endpoint 编辑）
- 快速配置页面（payload 格式变更）

此为开发辅助参考材料，不作为功能验收条件。UI 变更已由 FR-6a/6b/6c 描述，AC-8/9/10 覆盖验收。

## Acceptance Criteria

### AC-1: 单 endpoint 向后兼容
- **Given** 已有 Provider（迁移后 endpoints = `[{api_type: "openai", base_url: "...", api_key: null}]`）
- **When** 客户端发送 OpenAI 格式请求
- **Then** 使用该 endpoint，无格式转换，行为与迁移前完全一致

### AC-2: 多 endpoint 精确匹配（openai + anthropic）
- **Given** Provider 配置了 endpoints `[{api_type: "openai", base_url: "url-a", api_key: null}, {api_type: "anthropic", base_url: "url-b", api_key: null}]`
- **When** 客户端发送 OpenAI 格式请求
- **Then** 选择 api_type=openai 的 endpoint（base_url=url-a），不触发格式转换

### AC-2b: 多 endpoint 精确匹配（含 openai-responses）
- **Given** Provider 配置了 endpoints `[{api_type: "openai", ...}, {api_type: "openai-responses", ...}, {api_type: "anthropic", ...}]`
- **When** 客户端通过 POST /v1/responses 发送 Responses API 请求
- **Then** 选择 api_type=openai-responses 的 endpoint，不触发格式转换

### AC-3: 无匹配 endpoint 时格式转换降级
- **Given** Provider 只配置了 `[{api_type: "anthropic", base_url: "url-b", ...}]`
- **When** 客户端发送 OpenAI 格式请求
- **Then** 使用 anthropic endpoint（base_url=url-b），通过 FormatRegistry 转换请求/响应格式

### AC-3b: openai-responses 降级到 openai
- **Given** Provider 只配置了 `[{api_type: "openai", base_url: "url-a", ...}]`
- **When** 客户端发送 Responses API 请求（api_type=openai-responses）
- **Then** 使用 openai endpoint，FormatRegistry 处理 openai-responses ↔ openai 转换（两者同属 OpenAI 系，结构差异由 FormatRegistry 处理）

### AC-4: endpoint 独立 api_key + 加密存储
- **Given** 用户通过 Admin API 创建 Provider，endpoints 包含 `[{api_type: "openai", api_key: "key-a"}, {api_type: "anthropic", api_key: null}]`
- **When** 创建后读取 DB
- **Then** endpoints JSON 中的 api_key 为 AES 密文（非明文 "key-a"）
- **When** 通过 Admin API GET 读取 Provider
- **Then** 返回的 endpoints 中 api_key 为明文 "key-a"
- **When** 请求命中 openai endpoint → 实际使用的 api_key 为 "key-a"（解密正确）
- **When** 请求命中 anthropic endpoint → fallback 到 provider.api_key

### AC-5: DB 迁移 + 创建正向流程
- **Given** 现有 Provider 有 api_type/openai, base_url/xxx, api_key/yyy
- **When** 执行迁移（endpoints 列不存在时才 ADD COLUMN，endpoints IS NULL 的行才做数据填充）
- **Then** endpoints = `[{"api_type":"openai","base_url":"xxx","api_key":"encrypted_yyy","upstream_path":null}]`
- **And** 迁移后所有请求行为不变
- **And** 再次执行迁移脚本时不会重复处理（幂等）
- **Given** 用户通过 Admin API 创建新 Provider（endpoints 含两个 endpoint，各有独立 api_key）
- **When** 创建成功后发送两种格式的请求
- **Then** 两种请求分别成功路由到对应 endpoint

### AC-6: api_type 唯一性校验
- **Given** 用户创建 Provider，endpoints 包含两个 api_type="openai"
- **When** 提交创建请求
- **Then** 返回 400 错误，提示 api_type 不能重复

### AC-7: 日志记录上下游 api_type + base_url
- **Given** Provider 配置了 `[{api_type: "anthropic", base_url: "https://example.com/v1"}]`，客户端发送 openai 请求
- **When** 请求完成
- **Then** request_logs.api_type = "openai"（客户端类型）
- **And** request_logs.upstream_api_type = "anthropic"（实际上游类型）
- **And** request_logs.upstream_base_url = "https://example.com/v1"（实际使用的 base_url）

### AC-8: 前端 Provider 列表展示
- **Given** Provider 有 3 个 endpoints（openai, openai-responses, anthropic）
- **When** 查看 Provider 列表页
- **Then** API Type 列显示 3 个 Badge
- **And** 密钥列显示 3 行，每行有独立的复制按钮

### AC-9: QuickSetup payload 格式
- **Given** 用户通过 QuickSetup 创建 Provider（配置 openai api_type + base_url + api_key）
- **When** 创建完成后发送 OpenAI 格式请求
- **Then** 请求成功路由（验证 QuickSetup 的 endpoints payload 格式正确）

### AC-10: upstream_path 覆盖
- **Given** Provider 配置了 endpoints `[{api_type: "openai", base_url: "https://api.example.com", upstream_path: "/custom/path"}]`
- **When** 发送请求
- **Then** 实际请求 URL 为 `https://api.example.com/custom/path`（覆盖默认的 /v1/chat/completions）

## Constraints

- **最小化架构变更**：四层架构（Handler → Orchestrator → Routing → Transport）不变，只改数据源和中间层的属性获取方式
- **共享资源**：models、并发控制（max_concurrency/queue_timeout_ms/max_queue_size）、代理配置（proxy_type/proxy_url/proxy_username/proxy_password）全部在 Provider 级别共享
- **Transport 层无影响**：transport 只接收 `{ base_url: string }` 参数，不关心来源
- **Orchestrator 无影响**：只用 provider.id/name，不读 api_type/base_url
- **并发控制不受影响**：按 provider_id 管理，endpoint 共享同一个 provider 的并发池
- **加密方式一致**：endpoint 级 api_key 使用与 provider 级相同的 AES-256-GCM 加密
- **api_type 可选值**：openai、openai-responses、anthropic，用户选填，至少配 1 个。openai 和 openai-responses 同属 OpenAI 系但 API 结构不同（chat completions vs responses），两者之间也需要 FormatRegistry 转换

## Out of Scope

- 不改变 Failover/Retry/Modality Redirect/Overflow Redirect 等现有机制
- 不改变 Mapping Group/Target 的结构和语义
- 不改变 FormatRegistry 的转换逻辑（只是触发条件从"provider.api_type !== clientApiType"变为"resolved endpoint 的 api_type !== clientApiType"）
- 不改变并发控制、信号量、自适应并发的实现
- 不支持同一个 api_type 多个 endpoint（无意义）
- 不改变 Plugin 系统的架构（只调整 ProviderInfo 的字段来源）

## Decisions Made

1. **统一 endpoints JSON 字段而非新建关系表**：Provider 数量级小（< 50），JSON 字段性能足够，避免新表 + JOIN + 迁移的复杂度
2. **一次性迁移，不保留双路径**：迁移后所有代码只读 endpoints，不做"endpoints 为 null 则读旧字段"的兼容分支
3. **格式转换作为降级策略**：没有匹配 endpoint 时走现有 FormatRegistry，而非报错
4. **resolveEndpoint() 封装在 provider 模块**：消费者不感知 endpoints 存在，只消费 ResolvedEndpoint
5. **request_logs 双字段记录**：api_type 保持客户端类型（向后兼容），新增 upstream_api_type 记录实际类型

## 业务用例

### UC-1: 双协议供应商配置
- **Actor**: 管理员
- **场景**: 某供应商同时提供 OpenAI 和 Anthropic 兼容接口，希望一个 Provider 同时支持两种协议
- **预期结果**: 创建一个 Provider，配置两个 endpoint（openai + anthropic），客户端请求自动匹配对应协议

### UC-2: 单协议供应商不变
- **Actor**: 管理员
- **场景**: 现有供应商只有 OpenAI 接口，迁移后继续正常使用
- **预期结果**: 迁移后 endpoints = `[{api_type: "openai", ...}]`，行为与迁移前完全一致

### UC-3: 跨协议降级
- **Actor**: 客户端
- **场景**: Provider 只配了 anthropic endpoint，但客户端发送 openai 格式请求
- **预期结果**: 路由器自动通过 FormatRegistry 将 openai 格式转为 anthropic 格式发送，响应再转回 openai 格式

## Complexity Assessment

**中等**。数据模型变更涉及后端（DB 迁移 + 封装层 + 3 个中间层适配）和前端（Provider 表单 + 列表 + QuickSetup + 日志展示），但架构不变、控制流不变、影响面可控。核心风险在 DB 迁移的幂等性和前端表单的 UX。

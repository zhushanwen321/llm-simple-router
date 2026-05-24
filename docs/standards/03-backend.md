# 后端规范

> 适用于 `router/` 目录下的所有后端代码。基于 Fastify + TypeScript + better-sqlite3 + Node.js 22 技术栈。

---

## 目录

- [1. 技术栈概览](#1-技术栈概览)
- [2. 入口层规范](#2-入口层规范)
- [3. 核心层规范](#3-核心层规范)
- [4. 代理层规范（四层架构）](#4-代理层规范四层架构)
- [5. 数据库层规范](#5-数据库层规范)
- [6. 管理 API 规范](#6-管理-api-规范)
- [7. 认证规范](#7-认证规范)
- [8. 监控与指标采集规范](#8-监控与指标采集规范)
- [9. 转换层类型安全规范](#9-转换层类型安全规范)
- [10. 插件与 Hook 规范](#10-插件与-hook-规范)
- [11. 通用编码规范](#11-通用编码规范)
- [12. 构建与发布规范](#12-构建与发布规范)
- [13. 测试规范](#13-测试规范)
- [14. 新字段数据消费者检查清单](#14-新字段数据消费者检查清单)

---

## 1. 技术栈概览

### 1.1 核心依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| Fastify | — | HTTP 框架，插件化架构 |
| better-sqlite3 | — | 嵌入式 SQLite，同步 API |
| Node.js | 22 | 运行时 |
| TypeScript | — | 类型安全 |
| Vitest | 3.1.2 | 测试框架 |
| gpt-tokenizer | — | Token 计数（o200k_base） |

### 1.2 关键技术选型理由

| 选型 | 理由 |
|------|------|
| 原生 `http.request` 做代理 | 需要直接操作 SSE 流，axios 无法满足流式代理的精细控制需求 |
| better-sqlite3 | 同步 API 简化代码逻辑，无需 async/await 链；嵌入式部署零依赖 |
| Fastify | 插件系统支持依赖注入，生命周期 hook 丰富，性能优于 Express |
| ServiceContainer DI | 懒加载单例工厂，支持测试时替换实现 |

### 1.3 目录结构

```
router/src/
├── cli.ts                 # npm bin 入口
├── index.ts               # 库入口
├── config/                # 配置层
├── core/                  # 核心层（共享类型、常量、错误、DI）
├── proxy/                 # 代理层（四层架构）
│   ├── handler/           #   Handler 层
│   ├── orchestration/     #   Orchestration 层
│   ├── routing/           #   Routing 层
│   ├── transport/         #   Transport 层
│   ├── transform/         #   格式转换层
│   ├── enhancement/       #   代理增强
│   ├── loop-prevention/   #   循环检测
│   ├── patch/             #   上游响应修补
│   └── strategy/          #   路由策略
├── db/                    # 数据库层
├── admin/                 # 管理 API
├── middleware/            # 认证中间件
├── monitor/               # 监控层
├── metrics/               # 指标采集
├── utils/                 # 工具函数
└── db/migrations/         # SQL 迁移文件
```

---

## 2. 入口层规范

### 2.1 文件职责

| 文件 | 职责 | 调用方式 |
|------|------|---------|
| `src/cli.ts` | npm bin 入口，带 shebang（`#!/usr/bin/env node`），无条件调用 `main()` | `npx llm-simple-router` |
| `src/index.ts` | 库入口，导出 `buildApp` 和 `main`，支持编程式调用 | `import { buildApp } from 'llm-simple-router'` |

### 2.2 buildApp() 规范

`buildApp()` 是整个后端的组装函数，负责按顺序注册所有 Fastify 插件。

**插件注册顺序（不可调换）：**

```
seedDefaultRules
→ ModelStateManager.init
→ RetryRuleMatcher.load
→ ProviderSemaphoreManager
→ RequestTracker
→ 初始化所有 provider 并发配置
→ authMiddleware
→ openaiProxy
→ anthropicProxy
→ adminRoutes
→ fastifyStatic
```

**设计要点：**

- 支持注入 `db` 参数，测试时可传入内存数据库 `initDatabase(":memory:")`
- 使用 `ServiceContainer` 管理依赖，懒加载单例工厂
- `fastify-plugin (fp)` 包装代理插件以打破 Fastify 封装，使 hook 作用于全局

### 2.3 ServiceContainer 规范

`ServiceContainer`（`src/core/container.ts`）是轻量级 DI 容器：

- **懒加载**：注册工厂函数，首次访问时才实例化
- **单例保证**：同一 key 多次获取返回同一实例
- **可替换**：测试时可通过 `register()` 覆盖工厂函数

```typescript
// 注册
container.register('StateManager', () => new ModelStateManager(db));
container.register('SemaphoreManager', () => new ProviderSemaphoreManager());

// 获取（懒加载 + 单例）
const stateManager = container.get<ModelStateManager>('StateManager');
```

### 2.4 Health Check 端点规范

**P2 规则：`/health` 端点必须返回 DB 连通性和关键运行时指标。**

当前 `/health` 存在但内容不详。生产环境应返回：

- `db`: 数据库连接状态（`ok` / `error`）
- `uptime`: 进程运行时长（秒）
- `memory`: 堆内存使用（MB）
- `version`: 当前版本号

```typescript
app.get("/health", async () => {
  const dbOk = testDbConnection(db)  // 简单 SELECT 1
  return {
    status: dbOk ? "ok" : "degraded",
    db: dbOk ? "ok" : "error",
    uptime: Math.floor(process.uptime()),
    memory: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024),
    version: PACKAGE_VERSION,
  }
})
```

### 2.5 Graceful Shutdown 规范

**P2 规则：收到 SIGTERM 后应先排空活跃请求再关闭 DB 连接，而非立即超时退出。**

当前实现有超时强制退出机制，但未显式等待活跃代理请求完成。建议改进：

1. 收到 SIGTERM 后，停止接收新请求（`app.close()` 但保持现有连接）
2. 通知所有活跃 `StreamProxy` 和 `ResilienceLayer` 尽快结束（发送 `x-shutting-down` 标记）
3. 等待活跃请求计数归零或超过最大等待时间（建议 30s）
4. 关闭数据库连接（`db.close()`）

**正确顺序**：disconnect new connections → drain active requests → close DB → exit process

核心层位于 `router/src/core/`，提供全项目共享的基础设施。**核心层不得依赖代理层、数据库层、管理 API 层**，保持方向单一。

### 3.1 文件职责

| 文件 | 职责 | 关键导出 |
|------|------|---------|
| `types.ts` | 共享类型定义 | `Target`、`MappingStrategy`、`RetryStrategy` 等 |
| `constants.ts` | 共享常量 | HTTP 状态码、API 类型判断工具函数 |
| `errors.ts` | 共享错误类型 | `ProviderSwitchNeeded`、`ResilienceAttempt` |
| `registry.ts` | 状态注册接口 | `StateRegistry`（admin→proxy 解耦边界） |
| `container.ts` | DI 容器 | `ServiceContainer`（懒加载单例工厂） |

### 3.2 类型定义规范

- 所有跨模块共享的类型必须定义在 `types.ts` 中
- 单模块内部使用的类型可在模块内定义
- 类型命名使用 PascalCase，接口不加 `I` 前缀
- 使用 `type` 而非 `interface` 定义纯数据结构（无方法的场景）

### 3.3 常量定义规范

- HTTP 状态码使用语义常量，禁止魔法数字：

```typescript
// 禁止
if (response.statusCode === 429) { ... }

// 正确
const HTTP_TOO_MANY_REQUESTS = 429;
if (response.statusCode === HTTP_TOO_MANY_REQUESTS) { ... }
```

- API 类型判断使用工具函数，不直接检查路径字符串：

```typescript
// 禁止
if (req.url.includes('/v1/chat/completions')) { ... }

// 正确
import { isOpenAIChatApi } from './constants';
if (isOpenAIChatApi(req.url)) { ... }
```

### 3.4 错误类型规范

自定义错误类型必须继承 `Error`，并携带业务上下文：

```typescript
export class ProviderSwitchNeeded extends Error {
  constructor(
    public readonly target: Target,
    public readonly attempts: ResilienceAttempt[],
    public readonly reason: string,
  ) {
    super(reason);
    this.name = 'ProviderSwitchNeeded';
  }
}
```

- 错误类必须有 `name` 属性
- 错误消息必须包含足够的上下文用于排查问题
- 禁止空的 `catch` 块（见通用编码规范）

---

## 4. 代理层规范（四层架构）

代理层是核心业务逻辑所在，采用严格的四层架构，每层职责清晰、单向依赖。

### 4.1 架构总览

```
请求 → Handler → Orchestrator → Routing → Transport → 上游 API
        ↓            ↓                          ↓
      日志记录    信号量/重试/failover       HTTP/SSE 调用
```

| 层 | 目录 | 职责 | 可调用 |
|----|------|------|--------|
| Handler | `proxy/handler/` | 路由回调、映射解析、header 构建、日志记录 | Orchestrator |
| Orchestration | `proxy/orchestration/` | 协调信号量、tracker、resilience | Routing → Transport |
| Routing | `proxy/routing/` | 模型解析、溢出重定向、用量窗口追踪 | Transport |
| Transport | `proxy/transport/` | 底层 HTTP 调用、SSE 流式代理 | 无（最底层） |

**依赖方向：Handler → Orchestration → Routing → Transport，禁止反向依赖。**

### 4.2 Handler 层

#### 4.2.1 文件职责

| 文件 | 职责 |
|------|------|
| `handler/proxy-handler.ts` | `handleProxyRequest()` — 通用代理请求处理，映射解析、header 构建、日志记录 |
| `handler/openai.ts` | OpenAI 代理插件（`POST /v1/chat/completions`、`GET /v1/models`），注入 `stream_options` |
| `handler/anthropic.ts` | Anthropic 代理插件（`POST /v1/messages`），与 openai.ts 对称 |

#### 4.2.2 Handler 编码规范

- Handler 只负责请求预处理和响应后处理，业务逻辑委托给 Orchestrator
- 映射解析调用 `resolveMapping()`（Routing 层）
- Header 构建使用 `buildHeaders()`（`proxy-core.ts`），**禁止手动拼接上游 header**
- 请求日志必须在响应完成后写入，不能在请求处理过程中阻塞
- 两个 API 入口文件（`openai.ts`、`anthropic.ts`）保持对称结构

#### 4.2.3 请求处理流程

```
Handler (handler/proxy-handler.ts)
  applyEnhancement        → 代理增强（指令解析、命令拦截、会话记忆）
  resolveMapping          → 将 client_model 解析为 { backend_model, provider_id }
  buildHeaders            → 构建上游请求 header（脱敏后记日志）
  orchestrator.execute()  → 委托给 Orchestration 层
  insertSuccessLog        → 记录成功日志
  collectTransportMetrics → 采集传输指标
```

### 4.3 Orchestration 层

#### 4.3.1 文件职责

| 文件 | 职责 |
|------|------|
| `orchestration/orchestrator.ts` | `ProxyOrchestrator` — 协调信号量、tracker、resilience 三大 scope |
| `orchestration/resilience.ts` | 重试决策层：`ResilienceLayer` + fixed/exponential 策略 |
| `orchestration/semaphore.ts` | Provider 级并发控制：基于 Promise 的等待队列 |
| `orchestration/scope.ts` | 信号量/追踪器 scope 包装（`SemaphoreScope`、`TrackerScope`） |
| `orchestration/retry-rules.ts` | `RetryRuleMatcher`：从 DB 加载规则到内存 |

#### 4.3.2 Orchestrator 执行流程

```
orchestrator.execute()
  → SemaphoreScope.acquire()      // 队列满→503，超时→504
  → ResilienceLayer(transportFn)  // transportFn 循环：重试/failover 决策
    → Transport 调用
  → TrackerScope.complete()
```

#### 4.3.3 并发控制规范

- 每个 Provider 维护独立的信号量，互不影响
- 信号量基于 Promise 队列实现，支持 AbortSignal（客户端断连自动取消）
- 支持配置：`max_concurrency`、`queue_timeout_ms`、`max_queue_size`
- 队列满时返回 503，等待超时返回 504

#### 4.3.4 Resilience 规范

- 重试策略：fixed（固定间隔）、exponential（指数退避）
- 决策因素：HTTP 状态码 + 响应体匹配（正则）
- Failover：同一映射组内切换到下一个 Provider
- 重试循环必须有迭代计数器和上限（`while(true)` 规范见通用编码规范）
- 所有 catch 分支必须发送响应，不能让客户端挂起

### 4.4 Routing 层

#### 4.4.1 文件职责

| 文件 | 职责 |
|------|------|
| `routing/mapping-resolver.ts` | 将 client_model 解析为 `{ backend_model, provider_id }` |
| `routing/model-state.ts` | `ModelStateManager`：内存 + SQLite 双层缓存，24h 滑动窗口 |
| `routing/overflow.ts` | 溢出重定向：上下文超出时切换到更大模型 |
| `routing/usage-window-tracker.ts` | 5h 用量窗口追踪，启动时自动补齐缺失窗口 |
| `routing/enhancement-config.ts` | 加载代理增强配置（DB settings） |
| `routing/image-redirect.ts` | 图片检测 + fallback target prepend |

#### 4.4.2 映射解析规范

- 映射解析优先级：会话状态 > 映射组策略 > 单映射
- 溢出重定向时，token 计数必须使用 `gpt-tokenizer`（o200k_base），禁止字符长度估算
- 长文本（>4000 字符）使用采样外推策略避免性能问题

### 4.5 Transport 层

#### 4.5.1 文件职责

| 文件 | 职责 |
|------|------|
| `transport/http.ts` | 底层 HTTP 调用：`callNonStream()`、`callGet()`，构建原始 `http.request` |
| `transport/stream.ts` | SSE 流式代理引擎：`StreamProxy` 状态机 + `SSEMetricsTransform` 旁路采集 |
| `transport/transport-fn.ts` | 构建传输函数闭包，桥接 handler 参数和 transport 层 |

#### 4.5.2 SSE 流式代理规范

- 使用 `StreamProxy` 类管理缓冲状态机
- `SSEMetricsTransform` 作为旁路 Transform stream 采集指标，**不修改流经数据**
- SSE 事件按 `\n\n` 边界切割
- **多行 `data:` 必须用 `\n` 连接**，禁止直接拼接

```typescript
// 禁止
const combined = dataLine1 + dataLine2;

// 正确
const combined = [dataLine1, dataLine2].join('\n');
```

- 流式超时通过 `STREAM_TIMEOUT_MS` 环境变量控制，默认 3000000ms

#### 4.5.2.1 SSE 流背压处理

**P2 规则：StreamProxy 必须检测并处理 `socket.writableNeedDrain`。**

Node.js 官方文档强调 SSE 代理必须处理背压（backpressure）——上游数据流入速度快于下游客户端消费速度时，内存中缓冲的数据无限增长最终 OOM。

```typescript
// StreamProxy 正确做法：在可写端暂停/恢复
upstreamStream.on('data', (chunk) => {
  const canContinue = reply.raw.write(chunk)
  if (!canContinue) {
    upstreamStream.pause()
    reply.raw.once('drain', () => upstreamStream.resume())
  }
})
```

#### 4.5.3 HTTP 调用规范

- 使用原生 `http.request` 而非 axios
- 请求 header 构建使用 `buildHeaders()`（`proxy-core.ts`）
- 错误提取必须完整获取 `message` + `code` + `type` 三个字段
- URL 拼接使用 `buildUpstreamUrl()` 工具函数

#### 4.5.4 超时分级规范

**P2 规则：流式和非流式请求必须有不同的超时配置。**

当前全局 `STREAM_TIMEOUT_MS` 仅覆盖流式超时。非流式请求应配置独立的短超时：

| 类型 | 默认超时 | 配置方式 |
|------|---------|---------|
| 流式（SSE） | 3000s | `STREAM_TIMEOUT_MS` 环境变量 |
| 非流式（普通 POST） | 30s | 建议新增 `NON_STREAM_TIMEOUT_MS` |
| Admin API 内部调用 | 10s | 硬编码 |

#### 4.5.5 上游响应体大小限制

**P2 规则：上游响应必须设置最大读取字节数。**

恶意或异常的上游可能发送无限大响应导致 OOM。应在 Transport 层设置合理的 `maxBodySize`（默认建议 10MB），超出后截断并记录日志。

#### 4.5.6 连接池按 Provider 隔离

**P2 规则：不同 Provider 不应共享同一个 `http.Agent` 连接池。**

Node.js 官方推荐为不同后端创建独立 Agent 实例。当前 `ProxyAgentFactory` 的全局 keep-alive Agent 是多 Provider 共享的（`maxSockets: 50`），单 Provider 故障时可占满所有连接影响其他 Provider。

推荐改为按 Provider ID 维度缓存 Agent：

```typescript
class ProxyAgentFactory {
  private agentPool = new Map<string, { http: Agent; https: Agent }>()

  getAgentForProvider(providerId: string, url: string): Agent {
    // 按 providerId 隔离连接池
  }
}
```

### 4.6 代理共享模块

#### 4.6.1 文件职责

| 文件 | 职责 |
|------|------|
| `proxy-core.ts` | 共享工具：错误格式化工厂、上游 header 构建、GET 代理、URL 拼接 |
| `types.ts` | 代理层类型 re-export hub（实际类型定义在 `core/types.ts`） |
| `proxy-logging.ts` | 日志工具：header 脱敏、拦截日志、resilience 结果日志、transport 指标采集 |
| `log-helpers.ts` | DB 日志插入：`insertRejectedLog()`，携带 failover/retry 元数据 |

### 4.7 代理增强模块（`proxy/enhancement/`）

| 文件 | 职责 |
|------|------|
| `enhancement-handler.ts` | 代理增强主入口：指令解析、命令拦截、会话记忆 |
| `directive-parser.ts` | 从 user 消息中提取 `$SELECT-MODEL` / `[router-model]` / `[router-command]` 标记 |
| `response-cleaner.ts` | 清理历史消息中的路由标签 |

### 4.8 循环检测模块（`proxy/loop-prevention/`）

- 工具调用循环检测：检测同一函数被重复调用的模式
- 流式循环检测：基于 N-gram 算法检测重复输出模式
- 检测到循环时主动中断流并返回错误信息

### 4.9 路由策略模块（`proxy/strategy/`）

四种路由策略实现，每种策略实现 `select(targets, rule)` 接口：

| 策略 | 文件 | 行为 |
|------|------|------|
| `scheduled` | `strategy/scheduled.ts` | 定时切换 |
| `round-robin` | `strategy/round-robin.ts` | 轮询分配 |
| `random` | `strategy/random.ts` | 随机选择 |
| `failover` | `strategy/failover.ts` | 故障转移 |

---

## 5. 数据库层规范

### 5.1 总览

数据库层位于 `router/src/db/`，使用 better-sqlite3 的同步 API。

| 表 | 核心用途 |
|----|---------|
| `providers` | 供应商（含并发控制字段） |
| `mapping_groups` | 映射组（strategy + rule JSON） |
| `retry_rules` | 重试规则（status_code + body_pattern + 策略） |
| `request_logs` | 请求日志（完整链路） |
| `request_metrics` | Token 统计（input/output/cache、ttft、tps） |
| `router_keys` | 客户端密钥（SHA256 哈希 + AES 加密原文） |
| `settings` | 系统设置 |
| `session_model_states` | 会话模型状态 |
| `session_model_history` | 会话模型变更历史 |
| `model_mappings` | 旧版单映射（保留兼容） |

### 5.2 初始化与迁移

- `initDatabase()` 自动创建目录和执行迁移，无需手动建表
- 迁移文件位于 `src/db/migrations/*.sql`
- 迁移按文件名排序顺序执行
- 迁移必须是幂等的（使用 `IF NOT EXISTS` 等）

### 5.3 文件组织

按领域拆分文件：

| 文件 | 领域 |
|------|------|
| `providers.ts` | Provider CRUD |
| `mappings.ts` | 模型映射 |
| `groups.ts` | 映射组 |
| `logs.ts` | 请求日志 |
| `metrics.ts` | 指标数据 |
| `stats.ts` | 统计聚合 |
| `retry-rules.ts` | 重试规则 |
| `router-keys.ts` | 路由密钥 |
| `settings.ts` | 系统设置 |
| `session-states.ts` | 会话状态 |
| `helpers.ts` | 通用工具 |

### 5.4 安全工具函数

`helpers.ts` 提供两个安全工具：

#### 5.4.1 `buildUpdateQuery()`

白名单过滤安全字段的通用 UPDATE 语句构建器。只允许更新预定义的字段，防止注入意外字段。

```typescript
const { sql, params } = buildUpdateQuery(
  'providers',
  { name: 'New Name', max_concurrency: 10 },
  ['name', 'max_concurrency', 'base_url', 'api_key', 'models', 'enabled'],  // 白名单
  'WHERE id = ?',
  [providerId],
);
```

**禁止直接拼接 SQL**，所有动态 SQL 必须通过参数化查询。

#### 5.4.2 `deleteById()`

通用删除函数，按 ID 删除记录。

### 5.5 JSON 字段解析规范

**P0 规则：禁止对 DB 中的 JSON 字段直接 `JSON.parse`。**

DB 中 `providers.models` 等字段存储的是 JSON 文本，数据格式会演进（如从 `string[]` 到 `ModelEntry[]`）。所有解析必须通过对应的类型安全函数。

```typescript
// 禁止
const models = JSON.parse(provider.models) as string[];

// 正确
const models = parseModels(provider.models);
```

**原因：**
1. 格式演进时 `parseModels()` 可以做兼容处理，裸 `JSON.parse` 会导致运行时错误
2. 类型安全函数提供默认值和验证，裸解析容易遗漏
3. ESLint 规则 `taste/no-raw-json-parse-models` 强制执行此约束

### 5.6 数据加密规范

- 密钥存储：原文通过 AES-256-GCM 加密后存入 DB，查询时解密
- 密码哈希：使用 scrypt（格式：`salt:hash`）
- 加解密工具位于 `src/utils/crypto.ts`
- 格式：`iv:authTag:ciphertext`

### 5.7 Prepared Statement 缓存规范

better-sqlite3 的 `.prepare()` 每次调用都编译 SQL，高频路径上重复编译浪费 CPU。

**P1 规则：所有高频调用路径必须使用 `getCachedStmt()` 缓存 prepared statement。**

当前覆盖情况：

| 文件 | 缓存状态 | 典型调用频率 |
|------|---------|------------|
| `logs.ts` | 部分使用（5/12 处） | 每个代理请求 1 次 |
| `metrics.ts` | 已使用 `getCachedStmt` | 每个代理请求 1 次 |
| `mappings.ts` | **未缓存** | 每个代理请求 1-2 次 |
| `providers.ts` | **未缓存** | Admin API 调用 |
| `retry-rules.ts` | **未缓存** | 每个代理请求（规则匹配） |
| `router-keys.ts` | **未缓存** | 每个代理请求（认证） |
| `schedules.ts` | **未缓存** | 定时调度 |
| `stats.ts` | **未缓存** | Dashboard 刷新 |

```typescript
// 错误：每次函数调用都重新 prepare
function getActiveMappings(db: Database) {
  return db.prepare("SELECT * FROM mapping_groups WHERE is_active = 1").all()
}

// 正确：用 getCachedStmt 缓存
import { getCachedStmt } from "./helpers"
function getActiveMappings(db: Database) {
  return getCachedStmt(db,
    "SELECT * FROM mapping_groups WHERE is_active = 1"
  ).all()
}
```

### 5.8 日志清理规范

**P2 规则：批量 DELETE 必须加 LIMIT 分批执行。**

当前 `deleteLogsBefore()` 可能一次 DELETE 数万行，长事务持有 WAL 锁阻塞其他代理请求的日志写入。每批建议 1000 行。

### 5.9 SQL 索引审计

**P2 规则：新增高频查询前必须用 `EXPLAIN QUERY PLAN` 验证索引覆盖。**

日志查询的典型 WHERE 条件（`created_at`、`router_key_id`、`model`、`status_code`）需确认有对应索引。若 `EXPLAIN QUERY PLAN` 输出含 `SCAN` 则缺少索引。

---

## 6. 管理 API 规范

### 6.1 总览

管理 API 位于 `router/src/admin/`，提供后台管理的全部 CRUD 端点。

- 路由前缀：`/admin/api/`
- 认证：JWT + Cookie（`admin-auth.ts` 中间件）
- 跳过认证的路径：`/admin/api/setup/*`、`/admin/api/login`、`/admin/api/logout`

### 6.2 Schema 验证覆盖规范

**P1 规则：所有 Admin API 端点请求体必须有 JSON Schema 验证。**

当前覆盖：76 个端点中仅 24 个有 Schema（`mappings`、`schedules`、`usage`），其余模块（`providers`、`settings`、`logs`、`retry-rules`、`router-keys`、`quick-setup`、`import-export`、`upgrade`）无验证。

**为什么需要 Schema**：

1. **安全**：拒绝非法请求体，防止注入和类型混淆
2. **性能**：Fastify 的 JSON Schema 触发 `fast-json-stringify`，序列化性能提升 2-3x
3. **文档**：Schema 可作为 `@fastify/swagger` 的输入自动生成 OpenAPI 文档

```typescript
// 正确模式（参考现有 mappings.ts）
const CreateProviderSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  api_type: Type.String(),
  base_url: Type.String({ format: 'uri' }),
  api_key: Type.String(),
  models: Type.Optional(Type.String()),
  is_active: Type.Optional(Type.Boolean()),
})

app.post("/admin/api/providers",
  { schema: { body: CreateProviderSchema } },
  async (request, reply) => {
    const body = request.body as Static<typeof CreateProviderSchema>
  }
)
```

### 6.3 文件组织

| 文件 | 领域 |
|------|------|
| `routes.ts` | 统一注册所有 admin 路由 |
| `providers.ts` | Provider CRUD |
| `mappings.ts` | 模型映射 CRUD |
| `groups.ts` | 映射组 CRUD |
| `retry-rules.ts` | 重试规则 CRUD |
| `logs.ts` | 日志查询 |
| `stats.ts` | 统计数据查询 |
| `metrics.ts` | 指标数据查询 |
| `router-keys.ts` | 路由密钥管理 |
| `proxy-enhancement.ts` | 代理增强配置 |
| `monitor.ts` | 实时监控 |

### 6.3 端点设计规范

- 所有 CRUD 端点使用 RESTful 风格
- 响应格式统一：

```typescript
// 成功
{ data: T }
// 列表
{ data: T[], total: number }
// 错误
{ error: string, message: string }
```

- 使用 `buildUpdateQuery()` 构建更新语句，白名单过滤字段
- Provider 更新时必须同步刷新内存中的 `SemaphoreManager` 配置
- RetryRule 更新时必须自动刷新 `RetryRuleMatcher` 内存缓存

### 6.4 缓存一致性规范

Admin API 修改数据后，必须确保相关内存缓存同步更新：

| 操作 | 需要刷新的缓存 |
|------|--------------|
| Provider 更新 | `SemaphoreManager` 并发配置、`ModelStateManager` 缓存 |
| RetryRule 变更 | `RetryRuleMatcher` 内存缓存 |
| Mapping 变更 | `ModelStateManager` 缓存 |
| Setting 变更 | 代理增强配置缓存 |

---

## 7. 认证规范

### 7.1 客户端认证（`src/middleware/auth.ts`）

- 认证方式：Bearer Token
- 验证流程：Token → SHA256 哈希 → 查 `router_keys` 表
- 全局 `onRequest` hook
- 跳过路径：`/health`、`/admin/*`

### 7.2 管理后台认证（`src/middleware/admin-auth.ts`）

- 认证方式：JWT + Cookie
- 跳过路径：`/admin/api/setup/*`、`/admin/api/login`、`/admin/api/logout`
- JWT 密钥存储在 `settings` 表中

### 7.3 认证编码规范

- 禁止在日志中输出 token 原文或密码
- Token 比较使用常量时间算法，防止时序攻击
- 密码存储使用 scrypt 哈希，禁止明文存储

---

## 8. 监控与指标采集规范

### 8.1 监控层（`src/monitor/`）

| 文件 | 职责 |
|------|------|
| `request-tracker.ts` | 活跃请求 Map + 最近完成列表（200 条/5min TTL）+ SSE 广播 |
| `stats-aggregator.ts` | 环形缓冲区（1000）存储延迟样本，计算 p50/p99 |
| `runtime-collector.ts` | 采集内存、句柄、事件循环延迟 |

### 8.2 指标采集层（`src/metrics/`）

| 文件 | 职责 |
|------|------|
| `sse-parser.ts` | 行缓冲 SSE 解析器 |
| `metrics-extractor.ts` | 按 apiType 从 SSE 事件中提取 usage/TTFT/stop_reason |
| `sse-metrics-transform.ts` | Transform stream 旁路采集指标（不修改流经数据） |

### 8.3 SSE 实时监控

- Monitor 页面通过原生 `EventSource` 连接 SSE 端点
- 支持 6 种事件类型驱动 UI 更新
- 事件数据必须包含完整的请求上下文（method、path、status、latency 等）

### 8.4 Token 计数规范

**统一使用 `gpt-tokenizer`（o200k_base），禁止用字符长度估算 token 数。**

- `countTokens(text)`：精确计数，短文本直接计算
- `estimateInputTokens(body)`：从请求体提取文本并计数
- 长文本（>4000 字符）采用采样外推策略避免性能问题
- 当 API 未返回 `input_tokens` 时，`collectTransportMetrics()` 自动回退到 `estimateInputTokens()`

---

## 9. 转换层类型安全规范

转换层位于 `router/src/proxy/transform/`，负责不同 API 格式之间的转换。此层对类型安全有特殊要求。

### 9.1 核心原则

#### 原则 1：使用结构化类型，禁止裸 `Record<string, unknown>` 访问 API 字段

```typescript
// 禁止：字段名拼错不会报编译错误
const id = (item as any).id ?? "";

// 正确：入口断言为结构化类型，编译器检查字段名
const req = body as unknown as ResponsesApiRequest;
for (const item of (req.input as ResponseInputItem[])) {
  if (item.type === "function_call") {
    const id = item.call_id ?? item.id ?? "";
  }
}
```

#### 原则 2：函数签名保持 `Record<string, unknown>` 不变

导出函数的参数和返回类型保持 `Record<string, unknown>`（兼容 `FormatConverter` 接口），仅在函数体内部断言为具体类型。

```typescript
// 签名不变（兼容接口）
export function responsesToChatRequest(
  body: Record<string, unknown>,
): Record<string, unknown> {
  // 入口断言
  const req = body as unknown as ResponsesApiRequest;
  // 后续全用 req.xxx
}
```

#### 原则 3：数组遍历使用 discriminated union 收窄

```typescript
// 正确：通过 type 字段收窄
for (const item of items) {
  if (item.type === "function_call") {
    // TypeScript 自动收窄，item.call_id 可访问
  }
}
```

### 9.2 类型定义位置

| 类型 | 文件 |
|------|------|
| Responses API 类型 | `src/proxy/transform/types-responses.ts` |
| Chat Completions / Anthropic 类型 | `src/proxy/transform/types.ts` |

**新增 API 字段时必须同步更新对应的类型定义。禁止在各文件中重复定义同名接口。**

### 9.3 `Record<string, unknown>` 白名单

以下场景中 `Record<string, unknown>` 是合理且允许的：

| 场景 | 文件 | 说明 |
|------|------|------|
| 外部接口签名 | `format/types.ts` | `FormatConverter` 接口定义 |
| 输出对象构造 | `request-*.ts`、`response-*.ts` | 转换函数返回值 |
| 流式 SSE payload | `stream-*.ts` | SSE `data:` 字段经 JSON.parse 解析 |
| Patch 层 | `patch/*.ts` | 处理上游响应，字段访问多为单值 |
| 错误格式转换 | `transformErrorResponse` | 错误响应结构多变 |
| tool_choice 映射 | `mapToolChoice*` | 跨 API 格式差异大 |
| sanitize 工具 | `sanitize.ts` | JSON.parse 结果类型不定 |

---

## 10. 插件与 Hook 规范

### 10.1 双重注册要求

新增 PipelineHook 时，必须同时注册到两个位置：

```typescript
// 1. 注册到 hookRegistry（Admin API 查询用）
hookRegistry.register(hook);

// 2. 注册到 proxyPipeline（实际执行用）
proxyPipeline.register(hook);
```

**只有 `proxyPipeline.emit()` 调用才会实际执行 hook。`hookRegistry` 仅为 Admin API 查询用。**

### 10.2 Hook 执行路径验证

新增 Hook 后必须验证：
1. `registerBuiltinHooks()` 中注册到 `proxyPipeline`（非仅 `hookRegistry`）
2. `create-proxy-handler.ts` 中对应 phase 的 `proxyPipeline.emit()` 被调用
3. 两处缺一不可，遗漏即视为 MUST FIX

### 10.3 Hook 降级规范

PipelineHook 的 `execute()` 方法必须用 try-catch 包裹，异常不得传播到调用链。Hook 异常只能影响 Hook 自身的副作用，不能中断代理请求。

---

## 11. 通用编码规范

### 11.1 类型安全

| 规则 | 说明 |
|------|------|
| 禁止 `any` 类型 | 用 `unknown` 或具体类型替代 |
| 深拷贝用 `structuredClone()` | 替代 `JSON.parse(JSON.stringify())` |
| 禁止裸 `JSON.parse` 解析 DB JSON 字段 | 必须用 `parseModels()` 等类型安全函数 |
| 禁止裸 `Record<string, unknown>` 访问 API 字段 | 转换层内部必须断言为结构化类型 |
| 禁止 `String()` 转换非原始类型 | 可能输出 `[object Object]` |

### 11.2 循环与迭代

| 规则 | 说明 |
|------|------|
| `while(true)` 必须包含迭代计数器和上限 | 防止无限循环，ESLint 规则 `taste/no-unbounded-while-true` 强制 |
| 重试循环必须有最大重试次数 | 配合超时和计数器双重保障 |

```typescript
// 禁止
while (true) {
  const result = await tryRequest();
  if (result.success) break;
}

// 正确
const MAX_RETRIES = 10;
let attempt = 0;
while (attempt < MAX_RETRIES) {
  attempt++;
  const result = await tryRequest();
  if (result.success) break;
}
```

### 11.3 错误处理

| 规则 | 说明 |
|------|------|
| 所有 `catch` 分支必须有处理 | 禁止空 catch 块，ESLint 规则 `taste/no-silent-catch` 强制 |
| 兜底响应必须存在 | switch default、防御性检查必须发送响应，不能让客户端挂起 |
| 完整错误提取 | 解析上游错误响应时提取 `message` + `code` + `type` 所有字段 |
| headers 写入日志前必须脱敏 | `authorization`、`cookie`、`x-api-key` 等敏感 header |

```typescript
// 禁止：空 catch
} catch (e) {
}

// 禁止：只有 console
} catch (e) {
  console.error(e);
}

// 正确
} catch (e: unknown) {
  console.error('模块名.操作名:', e);
  // 根据场景选择：重试、降级、返回错误响应
  reply.code(500).send({ error: 'Internal Server Error', message: getErrorMessage(e) });
}
```

### 11.4 SSE 规范

| 规则 | 说明 |
|------|------|
| 多行 `data:` 用 `\n` 连接 | 禁止直接拼接 |
| 事件按 `\n\n` 边界切割 | SSE 协议规范 |
| 指标采集不修改流经数据 | `SSEMetricsTransform` 是旁路 Transform stream |

### 11.5 安全规范

| 规则 | 说明 |
|------|------|
| Token 计数统一用 `gpt-tokenizer` | 禁止字符长度估算 |
| 禁止运行时 `readFileSync` 加载可内联资源 | 模板、配置等应内联为 TS 常量 |
| `Object.entries()` 后拼 SQL/配置前必须白名单过滤 | ESLint 规则 `taste/no-unsafe-object-entries` |
| 幂等注册 | `register()` 方法必须检测重复 |
| 插件过滤一致性 | onError 必须与 beforeRequest 做同等的 provider 过滤 |

### 11.6 幂等性规范

- `register()` / `registerAdapter()` 方法必须检测重复，不可静默追加
- 迁移脚本必须幂等（使用 `IF NOT EXISTS`）
- `buildUpdateQuery()` 白名单过滤防止意外字段注入

---

## 12. 构建与发布规范

### 12.1 构建产物

构建后的 `dist/` 目录需要包含：

| 来源 | 目标 | 说明 |
|------|------|------|
| `src/**/*.ts` 编译 | `dist/**/*.js` | TypeScript 编译输出 |
| `src/db/migrations/*.sql` | `dist/db/migrations/*.sql` | 运行时读取的 SQL 文件 |
| `config/model-directory.json` | `dist/config/model-directory.json` | 模型元数据 |
| `frontend/dist/` | 通过 `FRONTEND_DIST` 环境变量指定 | 前端构建产物 |

### 12.2 postbuild 维护清单

当新增运行时需要的外部文件时，必须同时更新以下三处：

| 位置 | 用途 | 遗漏后果 |
|------|------|---------|
| `package.json` 的 `postbuild` 脚本 | 本地 `npm run build` 时复制 | 本地构建缺少文件 |
| `scripts/prepublish.mjs` | `npm publish` 前确保存在 | 发布包缺少文件 |
| `scripts/build.mjs` | `npm run build:full` 时复制 | 完整构建缺少文件 |

**三处缺少任何一处都可能导致发布包缺少文件。**

### 12.3 package.json 脚本规范

- `scripts` 值必须是合法 JSON 字符串
- 禁止在 JSON 字符串值中包含字面换行符（使用 `\n` 转义）
- 超过 200 字符的脚本应提取到 `scripts/` 目录下的独立 `.mjs` 文件

### 12.4 运行时文件读取分类

| 允许的运行时读取 | 禁止的运行时读取 |
|-----------------|-----------------|
| SQL 迁移文件（`.sql`） | prompt 模板（`.md`、`.txt`） |
| 外部 JSON 配置（`.json`） | 配置模板（`.txt`） |
| 运行时生成的日志文件 | 可内联为 TS 常量的文本 |
| `package.json`（版本检测） | — |

---

## 13. 测试规范

### 13.1 测试框架与配置

- **框架**：Vitest 3.1.2
- **配置**：`vitest.config.ts`（globals: true, environment: node）
- **测试文件位置**：`tests/` 目录

### 13.2 测试模式

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| 组件测试 | `Fastify()` + `.register()` + `.inject()` | API 端点测试 |
| 内存数据库 | `initDatabase(":memory:")` | 数据库层测试 |
| Mock 后端 | `http.createServer()` 在随机端口 | 代理转发测试 |
| 集成测试 | `buildApp({ config, db })` | 完整应用测试 |
| 策略测试 | 纯函数式，构造对象验证返回值 | 路由策略测试 |

### 13.3 辅助函数模式

多文件共享的辅助函数：

| 函数 | 用途 |
|------|------|
| `createMockBackend()` | 创建模拟上游服务器 |
| `closeServer()` | 安全关闭测试服务器 |
| `buildTestApp()` | 构建测试用 Fastify 应用 |
| `insertMockBackend()` | 插入模拟 Provider 数据 |
| `insertModelMapping()` | 插入测试用模型映射 |

### 13.4 测试原则

- 通过 `buildApp({ config, db })` 注入内存数据库，不做 DB 层 mock
- 每个测试间完全隔离，不共享数据库状态
- 验收标准（AC）必须有对应的测试用例覆盖
- 测试评审时以 AC 覆盖矩阵为依据

---

## 14. 新字段数据消费者检查清单

### 14.1 规则

**新增 DB 列或 metadata 字段时，必须列出所有数据消费者并逐一验证。遗漏任何消费者即视为 MUST FIX。**

### 14.2 消费者清单

新增字段时，按以下清单逐一检查：

| 消费者 | 检查内容 | 相关文件 |
|--------|---------|---------|
| DB 写入 | `insertMetrics()`、`insertRequestLog()` 等是否写入新字段 | `src/db/*.ts` |
| SSE 实时推送 | `RequestTracker` 的 `streamMetrics` 等是否推送新字段 | `src/monitor/request-tracker.ts` |
| Admin API 查询 | `getMetricsSummary()` 等是否返回新字段 | `src/admin/*.ts` |
| 前端展示 | 组件取数据路径是否使用新字段 | `frontend/src/**/*.vue` |
| 指标采集 | `metrics-extractor.ts` 等是否采集新字段 | `src/metrics/*.ts` |
| 日志记录 | 日志格式是否包含新字段 | `src/proxy/log-helpers.ts` |

### 14.3 检查流程

```
新增字段定义
  ↓
更新 DB 迁移（src/db/migrations/）
  ↓
按消费者清单逐一检查：
  1. DB 写入 → 确认 insert/update 函数包含新字段
  2. SSE 推送 → 确认 RequestTracker 广播新字段
  3. Admin API → 确认查询返回新字段
  4. 前端 → 确认组件使用新字段
  5. 指标采集 → 确认采集器提取新字段
  6. 日志 → 确认日志格式包含新字段
  ↓
每个消费者遗漏 = MUST FIX
```

---

## 附录 A：代码品味原则

以下原则自动规则难以覆盖，需要开发时自觉遵守：

| 原则 | 说明 |
|------|------|
| **兜底响应** | 所有 catch 分支、switch default、防御性检查必须发送响应 |
| **完整错误提取** | 解析上游错误时提取 message + code + type 所有字段 |
| **幂等注册** | register() 方法必须检测重复 |
| **structuredClone** | 深拷贝用 structuredClone() 替代 JSON.parse(JSON.stringify()) |
| **SSE data 拼接** | 多行 data: 用 \n 连接 |
| **插件过滤一致性** | onError 必须与 beforeRequest 做同等过滤 |
| **headers 安全** | 写入日志前必须脱敏 |
| **Hook 降级** | execute() 必须 try-catch，异常不得传播 |
| **数据消费者完整性** | 新字段必须列出所有消费点 |
| **前端控件模式一致** | 保存按钮模式页面新增控件不得直调 API |
| **Hook 注册验证** | 新增 Hook 必须注册到 proxyPipeline 并验证 emit 路径 |

## 附录 B：ESLint 自定义规则速查

| 规则 | 级别 | 说明 |
|------|------|------|
| `taste/prefer-allsettled` | warn | 独立数据源用 Promise.allSettled |
| `taste/no-silent-catch` | warn | catch 不能为空或仅 console |
| `taste/no-unsafe-object-entries` | warn | Object.entries() 后拼 SQL 前白名单过滤 |
| `taste/no-raw-json-parse-models` | error | 禁止裸 JSON.parse 解析 models 字段 |
| `taste/no-unsafe-string-conversion` | warn | 禁止 String() 转换非原始类型 |
| `taste/no-unbounded-while-true` | warn | while(true) 必须有迭代计数器和上限 |
| `taste/no-inline-import-type` | warn | 禁止行内 as import(...).Type |
| `taste/no-deprecated-rule-format` | warn | 禁止访问已废弃字段 |
| `taste/no-eslint-disable` | githook | 禁止 eslint-disable 注释 |

## 附录 C：环境变量

| 变量 | 默认值 | 说明 |
|------|-------|------|
| `PORT` | 9981 | 服务端口 |
| `DB_PATH` | `~/.llm-simple-router/router.db` | 数据库路径 |
| `LOG_LEVEL` | — | 日志级别 |
| `STREAM_TIMEOUT_MS` | 3000000 | 流式超时（ms） |
| `RETRY_BASE_DELAY_MS` | 1000 | 重试基础延迟（ms） |
| `FRONTEND_DIST` | — | 前端构建产物路径 |

# Pi Extension Alignment — 设计文档

> 日期：2026-05-03
> 分支：feat/pi-extension-alignment

## 1. 目标

将 llm-simple-router 的底层功能（并发控制、Loop 防护、请求监控）抽成独立 npm 包 `@llm-router/core`，使 pi coding agent 可以通过扩展的形式复用这些能力，同时 router 服务本身也引用同一个核心库。

## 2. 架构总览

```
@llm-router/core (npm 包)
  ├── concurrency/      信号量 + 自适应并发
  ├── loop-prevention/  会话追踪 + 流/tool 循环检测
  └── monitor/          请求追踪 + 统计聚合
       ↓ npm install
       ├── llm-simple-router    router 服务，引用 core + DB/Admin/HTTP
       └── pi-extension-router  pi 扩展，引用 core + pi ExtensionAPI 适配
```

## 3. 代码仓库结构

```
llm-simple-router/                      ← 仓库根（monorepo）
  package.json                          ← workspaces: ["core", "router", "pi-extension", "frontend"]
  tsconfig.base.json
  core/                                 ← @llm-router/core
    package.json
    tsconfig.json
    vitest.config.ts
    src/
      concurrency/
        semaphore.ts
        adaptive-controller.ts
        types.ts
        index.ts
      loop-prevention/
        session-tracker.ts
        stream-loop-guard.ts
        tool-loop-guard.ts
        types.ts
        index.ts
      monitor/
        request-tracker.ts
        stats-aggregator.ts
        runtime-collector.ts
        types.ts
        index.ts
      index.ts                          ← 统一导出
  router/                               ← llm-simple-router（现有 src/ 迁入）
    package.json
    tsconfig.json
    vitest.config.ts
    Dockerfile
    src/
      admin/
      db/
      proxy/
      middleware/
      config/
      metrics/
      storage/
      upgrade/
      utils/
      index.ts
      cli.ts
  pi-extension/                         ← pi 扩展
    package.json
    tsconfig.json
    src/
      index.ts                          ← 扩展入口 (ExtensionFactory)
      adapters/
        concurrency.ts
        loop-prevention.ts
        monitor.ts
  frontend/                             ← Admin 前端（保持原位）
    package.json
    src/
    ...
```

## 4. Core 包设计

### 4.1 导出方式

支持子路径导入和全量导入：

```typescript
import { SemaphoreManager } from "@llm-router/core/concurrency"
import { StreamLoopGuard } from "@llm-router/core/loop-prevention"
import { RequestTracker } from "@llm-router/core/monitor"
// 或
import { SemaphoreManager, StreamLoopGuard, RequestTracker } from "@llm-router/core"
```

package.json exports 配置：

```json
{
  "exports": {
    ".": { "import": "./dist/index.js" },
    "./concurrency": { "import": "./dist/concurrency/index.js" },
    "./loop-prevention": { "import": "./dist/loop-prevention/index.js" },
    "./monitor": { "import": "./dist/monitor/index.js" }
  }
}
```

### 4.2 去框架耦合原则

Core 包的迁移规则：

| 现有耦合 | 迁移方案 |
|---------|---------|
| pino logger (`app.log.debug(...)`) | 改为通用 `Logger` 接口，可选注入 |
| `better-sqlite3` | 不引入。Core 层不直接读 DB，配置通过构造函数/方法注入 |
| Fastify 特定类型 | 去掉，替换为纯 Node.js 接口 |
| `SemaphoreLogger` | 统一为 `Logger` 接口 |

### 4.3 通用 Logger 接口

```typescript
// core/src/types.ts
export interface Logger {
  debug?(obj: Record<string, unknown>, msg: string): void;
  warn?(obj: Record<string, unknown>, msg: string): void;
  error?(obj: Record<string, unknown>, msg: string): void;
}
```

### 4.4 concurrency 模块

从现有 `src/proxy/orchestration/semaphore.ts` 和 `src/proxy/adaptive-controller.ts` 迁移。

**公共接口：**

```typescript
// core/src/concurrency/types.ts
export interface ConcurrencyConfig {
  maxConcurrency: number;
  queueTimeoutMs: number;
  maxQueueSize: number;
}

export interface AdaptiveState {
  currentLimit: number;
  probeActive: boolean;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  cooldownUntil: number;
}

export interface AdaptiveResult {
  success: boolean;
  statusCode?: number;
}

// AdaptiveController 依赖的信号量操作接口
export interface ISemaphoreControl {
  updateConfig(providerId: string, config: ConcurrencyConfig): void;
}
```

**核心类：**

- `SemaphoreManager`（原 `ProviderSemaphoreManager`）— 按 providerId 管理信号量
  - `updateConfig(providerId, config)` — 更新配置
  - `acquire(providerId, signal?, onQueued?, logger?)` — 获取许可，返回 `AcquireToken`
  - `release(providerId, token, logger?)` — 释放许可
  - `getStatus(providerId)` — 查询活跃/排队数
  - `remove(providerId)` / `removeAll()` — 清理
- `AdaptiveController` — 自适应并发控制
  - 构造函数接受 `ISemaphoreControl`（解耦 `SemaphoreManager`）
  - `init(providerId, config, semParams)` — 初始化
  - `onRequestComplete(providerId, result)` — 请求完成后调整并发
  - `syncProvider(providerId, params)` — 同步 DB 配置变化
  - `getStatus(providerId)` — 查询自适应状态
- 错误类：`SemaphoreQueueFullError`, `SemaphoreTimeoutError`

### 4.5 loop-prevention 模块

从现有 `src/proxy/loop-prevention/` 迁移。**纯逻辑，零外部依赖，零修改。**

**公共接口：**

```typescript
// core/src/loop-prevention/types.ts
export interface LoopPreventionConfig {
  enabled: boolean;
  stream: StreamLoopGuardConfig;
  toolCall: ToolLoopGuardConfig;
  sessionTracker: SessionTrackerConfig;
}
```

**核心类：**

- `SessionTracker` — 会话级 tool call 记录
  - `recordToolCall(sessionId, record)` — 记录 tool call
  - `getRecentToolCalls(sessionId, limit)` — 获取近期记录
  - `cleanup()` — 过期清理
- `StreamLoopGuard` — ngram 检测流式内容重复
  - `feed(text)` — 喂入文本
  - `isLoop()` — 是否检测到循环
  - `reset()` — 重置状态
- `ToolLoopGuard` — 检测连续相同 tool call 循环
  - `check(toolName, input)` — 检查是否循环
  - `record(toolName, input)` — 记录（check + record 通常一起调用）
- 默认配置：`DEFAULT_LOOP_PREVENTION_CONFIG`

### 4.6 monitor 模块

从现有 `src/monitor/` 迁移。去掉 Fastify/pino 耦合。

**公共接口：**

```typescript
// core/src/monitor/types.ts
export interface ActiveRequest { ... }         // 原样
export interface StreamMetricsSnapshot { ... } // 原样
export interface StatsSnapshot { ... }         // 原样
export interface RuntimeMetrics { ... }        // 原样

// SSE 推送能力抽象
export interface SSEClient {
  write(data: string): void;
}
```

**核心类：**

- `RequestTracker` — 请求生命周期追踪
  - 构造函数：可选注入 `semaphoreStatusProvider` 和 `logger`
  - `startRequest(params)` — 创建追踪记录
  - `completeRequest(id, result)` — 完成追踪
  - `getActiveRequests()` — 获取活跃请求列表
  - `getStats()` — 获取统计快照
  - `addSSEClient(client)` / `removeSSEClient(client)` — SSE 推送
  - `startPushInterval()` / `stopPushInterval()` — 定时推送
- `StatsAggregator` — 统计聚合
  - `record(providerId, latencyMs, statusCode)` — 记录请求结果
  - `getSnapshot()` — 获取统计快照
  - `reset()` — 重置统计
- `RuntimeCollector` — 运行时指标收集
  - `collect()` — 采集内存/事件循环/句柄等指标

## 5. Router 重构

### 5.1 迁移策略

现有 `src/` 下代码迁移到 `router/src/`，主要改动：

1. **import 路径变更**：`./core/semaphore` → `@llm-router/core/concurrency`
2. **去掉已迁移的源文件**：`src/proxy/orchestration/semaphore.ts`、`src/proxy/loop-prevention/*`、`src/monitor/*` 等
3. **Logger 适配**：pino logger → core 的 `Logger` 接口，通过适配器桥接
4. **类型重新导出**：`router/src/core/types.ts` 中保留 router 特有的类型，core 的类型从包导入

### 5.2 router 特有代码（不进 core）

以下代码留在 `router/src/`：

- `admin/` — RESTful Admin API
- `db/` — SQLite 持久化
- `proxy/handler/` — OpenAI/Anthropic 代理处理器
- `proxy/transform/` — 消息格式转换
- `proxy/routing/` — 模型映射路由
- `proxy/transport/` — HTTP 传输
- `middleware/` — 认证中间件
- `config/` — 环境变量配置
- `storage/` — 日志文件存储
- `upgrade/` — 版本升级
- `utils/` — 工具函数

## 6. Pi 扩展设计

### 6.1 目录结构

```
~/.pi/agent/extensions/llm-router/
  index.ts              ← 扩展入口
  config.json           ← 用户配置（pi 专用）
  package.json          ← deps: @llm-router/core, @mariozechner/pi-coding-agent
  node_modules/
```

### 6.2 配置文件 config.json

```json
{
  "concurrency": {
    "anthropic": {
      "maxConcurrency": 5,
      "queueTimeoutMs": 5000,
      "maxQueueSize": 100,
      "adaptive": true
    },
    "openai": {
      "maxConcurrency": 3,
      "queueTimeoutMs": 5000,
      "maxQueueSize": 50,
      "adaptive": false
    }
  },
  "loopPrevention": {
    "enabled": true,
    "stream": {
      "enabled": true,
      "detectorConfig": { "n": 6, "windowSize": 1000, "repeatThreshold": 10 }
    },
    "toolCall": {
      "enabled": true,
      "minConsecutiveCount": 3,
      "detectorConfig": { "n": 6, "windowSize": 500, "repeatThreshold": 5 }
    }
  },
  "monitor": {
    "enabled": true,
    "statsIntervalMs": 60000
  }
}
```

### 6.3 扩展入口 index.ts 职责

1. **读取 config.json** — 加载用户配置
2. **初始化 core 模块** — 根据配置创建 SemaphoreManager、LoopGuards、RequestTracker
3. **钩入 pi 生命周期事件**：
   - `tool_call` → tool loop 检测，可 block
   - `message_update` → stream loop 检测，可 abort
   - `message_end` → 记录监控数据，反馈 adaptive 并发
   - `session_start` / `session_shutdown` → 初始化/清理
4. **注册 pi 工具**：
   - `router_status` — LLM 可查询当前并发/防护/监控状态
5. **注册 pi 命令**：
   - `/router-stats` — 用户查看监控统计
   - `/router-reset` — 重置统计和防护状态

### 6.4 provider 映射

pi 的 provider 名（如 `anthropic`、`openai`）与 config.json 中的 key 直接对应。扩展通过 `event.message.provider` 或 `ctx.model.provider` 获取当前 provider 名，查找对应配置。

## 7. 实施步骤

### Phase 1：Core 包提取
1. 创建 monorepo 结构（`core/`、`router/`、`pi-extension/`、`frontend/`）
2. 迁移 concurrency 模块，去 pino 耦合
3. 迁移 loop-prevention 模块（零修改）
4. 迁移 monitor 模块，去 Fastify 耦合
5. 迁移现有测试到 core
6. 配置 workspace 和构建

### Phase 2：Router 重构
1. 将 `src/` 迁移到 `router/src/`
2. 替换内部 import 为 `@llm-router/core`
3. 添加 pino → Logger 适配器
4. 确保所有测试通过
5. 确保 Admin Dashboard 正常工作

### Phase 3：Pi 扩展开发
1. 创建 `pi-extension/` 项目
2. 实现适配层（concurrency/loop-prevention/monitor）
3. 编写 config.json 示例
4. 测试 pi 扩展功能

## 8. 不在范围内

以下功能 **不进入** core 包：

- **路由/映射** — pi 自己配置 provider，不需要路由层
- **重试** — pi 已有自动重试（指数退避）
- **消息格式转换** — pi SDK 各 provider 已内置
- **SSE 解析** — pi SDK 已内置
- **DB/Admin** — router 特有
- **Transform 插件** — pi extension 系统已覆盖

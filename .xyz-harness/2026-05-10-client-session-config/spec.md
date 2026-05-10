# 客户端 Session 识别配置化 + Core 包合并 + Pi 插件精简

## 目标

三部分改动：
1. 将硬编码的客户端 session header 识别改为可配置，支持多种客户端类型（claude-code、pi、codex 等）
2. 将 `@llm-router/core` 包（约 1800 行）合并到 `router/src/core/`，去掉独立 npm 包
3. 精简 pi-extension，只保留 session_id header 注入

## 背景

当前客户端识别逻辑硬编码在 `detectClientAgentType()` 中：
- Claude Code：检查 `x-claude-code-session-id` header 存在
- Pi：检查 `x-client-type === "pi-coding-agent"` 或 User-Agent 包含 `"pi-coding-agent"`

问题：
- 新增客户端类型需要改代码重新发布
- User-Agent 值匹配不可靠且多余（有 session header 就够了）
- core 包独立发布增加维护成本，且只有 router 一个消费者
- pi-extension 功能与 router 重复（并发控制、循环防护、监控），实际无人使用

## 方案

### Part 1: 客户端 Session 识别配置化

**配置模型：**

DB settings 表新增 key: `client_session_headers`，值为 JSON 数组：

```json
[
  {"client_type": "claude-code", "session_header_key": "x-claude-code-session-id"},
  {"client_type": "pi", "session_header_key": "x-pi-session-id"}
]
```

默认值如上。用户可新增条目（如 codex），也可修改现有条目的 header_key。

**识别逻辑：**
- 遍历配置列表，检查请求 headers 中是否有对应的 `session_header_key`
- 第一个匹配的条目确定 `client_type`，同时从该 header 的值获取 `session_id`
- 无匹配 → `client_type: "unknown"`, `session_id: undefined`
- **移除** User-Agent 和 `x-client-type` 值匹配逻辑

**后端改动：**

| 文件 | 改动 |
|------|------|
| `router/src/db/settings.ts` | 新增 `getClientSessionHeaders(db)` / `setClientSessionHeaders(db, config)` |
| `router/src/proxy/handler/proxy-handler-utils.ts` | 重构 `detectClientAgentType` → `detectClient`，接受配置参数 |
| `router/src/proxy/hooks/builtin/client-detection.ts` | 从 DB 加载配置，使用 `detectClient()`，将结果写入 metadata |
| `router/src/proxy/hooks/builtin/error-logging.ts` | 3 处 `ctx.sessionId` → `ctx.metadata.get("session_id")`；1 处 `detectClientAgentType()` → `ctx.metadata.get("client_type")` |
| `router/src/proxy/hooks/builtin/request-logging.ts` | 3 处 `ctx.sessionId` → `ctx.metadata.get("session_id")`（含 1 处已有 metadata fallback）；1 处 `detectClientAgentType()` → `ctx.metadata.get("client_type")` |
| `router/src/proxy/hooks/builtin/enhancement-preprocess.ts` | 6 处 `sessionId` 解构和引用改为 `ctx.metadata.get("session_id")` |
| `router/src/proxy/pipeline/context.ts` | 移除硬编码 `x-claude-code-session-id` |
| `router/src/proxy/pipeline/types.ts` | 移除 `PipelineContext.sessionId` 字段（改用 metadata） |
| `router/src/proxy/handler/failover-loop.ts` | 19 处 `ctx.sessionId` → `ctx.metadata.get("session_id")`；`detectClientAgentType()` → `ctx.metadata.get("client_type")` |
| `router/src/proxy/handler/create-proxy-handler.ts` | 1 处 `ctx.sessionId` → `ctx.metadata.get("session_id")` |
| `router/src/proxy/proxy-logging.ts` | 4 处 `params.sessionId` 参数传递需适配 metadata |
| `router/src/proxy/tool-error-logger.ts` | 1 处 `ctx.sessionId` → `ctx.metadata.get("session_id")` |
| `router/src/proxy/orchestration/orchestrator.ts` | 接口定义 + 赋值中的 `sessionId` 字段需同步修改 |
| `router/src/admin/settings.ts` | 新增 GET/PUT `/admin/api/settings/client-session-headers` |

**前端改动：**

ProxyEnhancement.vue 新增「客户端识别」Card：
- 展示当前配置的客户端列表，每条显示 client_type 和 session_header_key
- 支持修改 header_key、新增条目、删除条目
- 保存按钮触发 PUT API
- 说明文字：告知用户默认配置，以及如何为 Pi/Claude Code 配合使用

### Part 2: Core 包合并

**文件迁移：**

| 源 | 目标 |
|----|------|
| `core/src/concurrency/` | `router/src/core/concurrency/` |
| `core/src/loop-prevention/` | `router/src/core/loop-prevention/` |
| `core/src/monitor/` | `router/src/core/monitor/` |
| `core/src/errors.ts` (SemaphoreQueueFullError, SemaphoreTimeoutError) | 合并到 `router/src/core/errors.ts` |
| `core/src/types.ts` (Logger) | 合并到 `router/src/core/types.ts` |

**Import 更新（40 处，分布在 20 个文件）：**

涉及文件：`index.ts`、`admin/monitor.ts`、`admin/providers.ts`、`admin/quick-setup.ts`、`admin/routes.ts`、`core/errors.ts`、`core/pino-logger.ts`、`core/sse-client-adapter.ts`、`core/types.ts`、`proxy/handler/create-proxy-handler.ts`、`proxy/handler/failover-loop.ts`、`proxy/handler/proxy-handler-utils.ts`、`proxy/hooks/builtin/enhancement-preprocess.ts`、`proxy/hooks/builtin/request-logging.ts`、`proxy/orchestration/orchestrator.ts`、`proxy/orchestration/scope.ts`、`proxy/proxy-logging.ts`、`proxy/transport/stream.ts`、`proxy/transport/transport-fn.ts`

| 旧 import | 新 import（示例） |
|-----------|------------------|
| `@llm-router/core` | `../core/errors.js` 或相对路径 |
| `@llm-router/core/concurrency` | `../core/concurrency/index.js` |
| `@llm-router/core/loop-prevention` | `../core/loop-prevention/index.js` |
| `@llm-router/core/monitor` | `../core/monitor/index.js` |

**测试迁移：**

将 `core/tests/` 9 个测试文件（1523 行）迁移到 `router/tests/core/` 对应子目录，更新 import 路径：
- `core/tests/concurrency/` → `router/tests/core/concurrency/`
- `core/tests/loop-prevention/` → `router/tests/core/loop-prevention/`
- `core/tests/monitor/` → `router/tests/core/monitor/`

**清理：**
- 删除 `core/` 目录（含 core/src 和 core/tests）
- 根 `package.json` 移除 `"core"` workspace
- `router/package.json` 移除 `@llm-router/core` 依赖
- CI/publish workflow 中移除 core 相关的 npm publish 步骤

### Part 3: Pi 插件精简

**保留：**
- `before_provider_request` hook：注入 `x-pi-session-id` header
- session_id 来源：pi 的 session context

**移除：**
- 并发控制（SemaphoreManager、AdaptiveController）
- 循环防护（ToolLoopGuard、StreamLoopGuard、NGramLoopDetector）
- 监控（RequestTracker）
- `router_status` tool、`router-stats` 和 `router-reset` command
- `@llm-router/core` 依赖

精简后代码量预估：~30 行。

## 数据流

### 新增数据字段

| 字段 | 类型 | 生产者 | 存储位置 | 消费者 | 读取时机 |
|------|------|--------|---------|--------|----------|
| client_session_headers | TEXT (JSON) | Admin API | settings DB | client-detection hook | 每次请求（通过 getSetting 直读，项目现有模式） |
| client_type | metadata | client-detection hook | ctx.metadata | error-logging / request-logging / failover-loop | hook 执行时 |
| session_id | metadata | client-detection hook | ctx.metadata | cache-estimation / request-logging / enhancement / 所有 hook | hook 执行时 |

### 数据流图

```
Admin API → settings DB (client_session_headers)
                           ↓ (每次请求通过 getSetting 读取)
client-detection hook (pre_route, priority 200)
  → 遍历配置 → 匹配 request headers
  → ctx.metadata.set("client_type", ...)
  → ctx.metadata.set("session_id", ...)
                           ↓
failover-loop / error-logging / request-logging / cache-estimation
  → ctx.metadata.get("client_type") / ctx.metadata.get("session_id")
```

### 时序要求
- 生产者写入时机：client-detection hook 在 pre_route 阶段（priority 200）执行，是最早的业务 hook
- 消费者读取时机：所有后续 hook（post_route / pre_transport / post_response）和 handler 层代码通过 `ctx.metadata.get()` 读取
- **关键约束**：`failover-loop.ts`、`error-logging.ts`、`request-logging.ts` 中原有 `detectClientAgentType()` 直接调用，必须统一改为从 metadata 读取，确保识别结果与 hook 一致

## 验收标准

### AC1: Session 识别配置化 — 后端

1. DB settings 中有默认 `client_session_headers` 配置（claude-code + pi 两条）
2. `detectClient()` 根据配置匹配 headers，不再检查 User-Agent 和 x-client-type 值
3. 无匹配请求的 client_type 为 "unknown"
4. Admin API GET/PUT 端点正常工作
5. 修改配置后无需重启即生效（通过 getSetting 直读）
6. `PipelineContext.sessionId` 字段已移除，所有消费方（failover-loop 19 处、create-proxy-handler 1 处、proxy-logging 4 处、tool-error-logger 1 处、error-logging 3 处、request-logging 3 处、enhancement-preprocess 6 处、orchestrator 2 处）改用 `ctx.metadata.get("session_id")`
7. `detectClientAgentType()` 所有 3 处直接调用改为从 `ctx.metadata.get("client_type")` 读取

### AC2: Session 识别配置化 — 前端

1. ProxyEnhancement 页面有「客户端识别」Card
2. 展示默认配置（claude-code + pi），支持编辑 header_key
3. 支持新增条目（填 client_type + header_key）
4. 支持删除条目
5. 保存按钮触发 API，成功后显示 toast

### AC3: Core 包合并

1. `core/` 目录已删除（含 src 和 tests）
2. 9 个核心测试文件已迁移到 `router/tests/core/`，测试通过
3. 所有 40 处 `@llm-router/core` import 已替换为相对路径（20 个文件）
4. `npm run build` 编译通过
5. `npm test` 全部通过（含迁移后的 core 测试）
6. `npm run lint` 零警告
7. CI/publish workflow 中无 core 发布步骤

### AC4: Pi 插件精简

1. pi-extension 不再依赖 `@llm-router/core`
2. pi-extension 只包含 session_id header 注入
3. pi-extension 编译通过
4. pi 插件安装后，请求自动携带 `x-pi-session-id` header

### AC5: 端到端

1. Claude Code 请求（带 `x-claude-code-session-id`）→ 正确识别
2. Pi 请求（带 `x-pi-session-id`）→ 正确识别
3. 新增 codex 配置 → 携带对应 header 的请求被正确识别
4. 旧版 Pi（仅 User-Agent 含 pi-coding-agent，无 session header）→ 不再被识别

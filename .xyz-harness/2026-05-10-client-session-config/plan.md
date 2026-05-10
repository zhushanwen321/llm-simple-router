# 实现计划

## 执行顺序

Task 1（Core 合并）先做，因为后续文件位置会变。Task 2-3-4 是 Session 配置化的三个层次，串行执行。Task 5（Pi 插件）可与 Task 4 并行。Task 6 最后验证。

---

## Task 1: Core 包合并

**目标：** 将 `@llm-router/core` 代码移入 `router/src/core/`，测试迁移到 `router/tests/core/`，删除独立包。

**步骤：**

1. 复制 `core/src/concurrency/` → `router/src/core/concurrency/`
2. 复制 `core/src/loop-prevention/` → `router/src/core/loop-prevention/`
3. 复制 `core/src/monitor/` → `router/src/core/monitor/`
4. 将 `core/src/errors.ts` 中的 `SemaphoreQueueFullError`、`SemaphoreTimeoutError` 合并到 `router/src/core/errors.ts`（当前是 re-export，改为直接定义或 re-export 自新位置）
5. 将 `core/src/types.ts` 中的 `Logger` 类型合并到 `router/src/core/types.ts`
6. 更新 20 个文件中 40 处 `@llm-router/core` import 为相对路径
7. 迁移 `core/tests/` 9 个测试文件到 `router/tests/core/` 对应子目录，更新 import
8. 删除 `core/` 目录
9. 根 `package.json` 移除 `"core"` workspace
10. `router/package.json` 移除 `@llm-router/core` 依赖
11. 更新 `.github/workflows/publish.yml` 移除 core 发布步骤
12. 验证：`npm run build && npm test && npm run lint`

**涉及文件（~30 个）：**
- `router/src/core/` — 新增 concurrency/、loop-prevention/、monitor/ 子目录
- `router/src/core/errors.ts` — 合并错误类
- `router/src/core/types.ts` — 合并 Logger 类型
- 20 个 router/src/ 文件 — import path 更新
- `router/tests/core/` — 新增，从 core/tests/ 迁入 9 个测试
- `core/` — 删除
- `package.json` (root) — 移除 workspace
- `router/package.json` — 移除依赖
- `.github/workflows/publish.yml` — 移除 core 步骤

---

## Task 2: Session Header 配置化 — 后端 DB + Settings + API

**目标：** 新增配置存储和 Admin API。

**步骤：**

1. `router/src/db/settings.ts` 新增：
   - `getClientSessionHeaders(db)` — 读取 `client_session_headers` setting，JSON.parse，fallback 默认值
   - `setClientSessionHeaders(db, config)` — JSON.stringify 后写入
   - `ClientSessionHeaderEntry` 类型定义：`{client_type: string, session_header_key: string}`
2. `router/src/admin/settings.ts` 新增：
   - `GET /admin/api/settings/client-session-headers` — 返回配置数组
   - `PUT /admin/api/settings/client-session-headers` — 验证并写入
3. 验证：编译通过

**涉及文件（2 个）：**
- `router/src/db/settings.ts`
- `router/src/admin/settings.ts`

---

## Task 3: Session Header 配置化 — 后端识别逻辑重构

**目标：** 将硬编码的客户端识别改为配置驱动，移除 `PipelineContext.sessionId`。

**步骤：**

1. `router/src/proxy/handler/proxy-handler-utils.ts`：
   - 移除 `detectClientAgentType(headers)` 和 `ClientAgentType` 类型
   - 新增 `detectClient(headers, config)` 返回 `{client_type: string, session_id: string | undefined}`
   - 新增 `ClientSessionHeaderConfig` 类型
2. `router/src/proxy/hooks/builtin/client-detection.ts`：
   - 从 DB 加载 `client_session_headers` 配置（通过 `getClientSessionHeaders(db)`）
   - 调用 `detectClient(headers, config)`
   - 将 `client_type` 和 `session_id` 写入 `ctx.metadata`
3. `router/src/proxy/pipeline/types.ts`：
   - 移除 `PipelineContext.sessionId` 字段
4. `router/src/proxy/pipeline/context.ts`：
   - 移除 `x-claude-code-session-id` 硬编码和 `sessionId` 初始化
5. 更新所有 `ctx.sessionId` 消费方（改为 `ctx.metadata.get("session_id")`）：
   - `failover-loop.ts`（19 处）
   - `create-proxy-handler.ts`（1 处）
   - `proxy-logging.ts`（4 处，注意参数传递链）
   - `tool-error-logger.ts`（1 处）
   - `orchestrator.ts`（接口定义 + 赋值）
6. 更新所有 `detectClientAgentType()` 直接调用方（改为 `ctx.metadata.get("client_type")`）：
   - `failover-loop.ts`（1 处）
   - `error-logging.ts`（1 处）
   - `request-logging.ts`（1 处）
7. 更新遗漏的 `ctx.sessionId` → `ctx.metadata.get("session_id")` 消费方：
   - `error-logging.ts`（3 处）
   - `request-logging.ts`（3 处，含 1 处已有 metadata fallback）
   - `enhancement-preprocess.ts`（6 处：解构 + sessionKey 构建 + 日志）
8. 验证：编译通过 + 相关测试通过

**涉及文件（12 个）：**
- `router/src/proxy/handler/proxy-handler-utils.ts`
- `router/src/proxy/hooks/builtin/client-detection.ts`
- `router/src/proxy/hooks/builtin/error-logging.ts`
- `router/src/proxy/hooks/builtin/request-logging.ts`
- `router/src/proxy/hooks/builtin/enhancement-preprocess.ts`
- `router/src/proxy/pipeline/types.ts`
- `router/src/proxy/pipeline/context.ts`
- `router/src/proxy/handler/failover-loop.ts`
- `router/src/proxy/handler/create-proxy-handler.ts`
- `router/src/proxy/proxy-logging.ts`
- `router/src/proxy/tool-error-logger.ts`
- `router/src/proxy/orchestration/orchestrator.ts`

---

## Task 4: Session Header 配置化 — 前端

**目标：** ProxyEnhancement 页面新增客户端识别配置 Card。

**步骤：**

1. `frontend/src/api/client.ts`：
   - 新增 `getClientSessionHeaders()` — GET
   - 新增 `updateClientSessionHeaders(config)` — PUT
   - 新增 API 路径常量
2. `frontend/src/views/ProxyEnhancement.vue`：
   - 新增「客户端识别」Card，位于 Token 预估 Card 之前
   - 展示客户端列表，每条显示 client_type（只读标签）和 session_header_key（可编辑 Input）
   - 支持新增条目（Button 触发）
   - 支持删除条目（Button 触发，至少保留 1 条）
   - 遵循保存按钮模式（不直调 API）
   - 说明文字：解释默认配置和用途
3. 验证：`cd frontend && npx vue-tsc -b --noEmit && npm run build`

**涉及文件（2 个）：**
- `frontend/src/api/client.ts`
- `frontend/src/views/ProxyEnhancement.vue`

---

## Task 5: Pi 插件精简

**目标：** pi-extension 只保留 session_id header 注入。

**步骤：**

1. 重写 `pi-extension/src/index.ts`：
   - 移除所有并发控制、循环防护、监控代码
   - 只保留 `pi.on("before_provider_request", ...)` 注入 `x-pi-session-id` header
   - session_id 从 pi 的 session context 获取
2. 简化 `pi-extension/src/config.ts`：移除不再需要的配置接口
3. 更新 `pi-extension/package.json`：
   - 移除 `@llm-router/core` 依赖
   - 移除其他不再需要的依赖
4. 验证：`cd pi-extension && npm run build`（如有构建脚本）

**涉及文件（3 个）：**
- `pi-extension/src/index.ts`
- `pi-extension/src/config.ts`
- `pi-extension/package.json`

---

## Task 6: 测试更新 + 全量验证

**目标：** 更新受影响的测试，全量验证。

**步骤：**

1. 更新引用 `@llm-router/core` 的测试文件 import（router/tests/ 中）
2. 更新引用 `detectClientAgentType` 的测试
3. 更新引用 `ctx.sessionId` 的测试
4. 新增测试：
   - `detectClient()` 单元测试（配置匹配、默认值、unknown）
   - `getClientSessionHeaders()` / `setClientSessionHeaders()` 单元测试
   - Admin API 端点测试
5. 全量验证：`npm run build && npm test && npm run lint`
6. 前端验证：`cd frontend && npx vue-tsc -b --noEmit && npm run build`
7. 前端 lint：`cd frontend && npx eslint . --max-warnings=0`

**涉及文件：**
- 需 grep 确认引用旧 API 的测试文件
- 新增测试文件（~1-2 个）

---

## 依赖关系

```
Task 1 (Core 合并)
  ↓
Task 2 (Session DB + API)
  ↓
Task 3 (Session 识别逻辑重构) ← 依赖 Task 1（文件位置）+ Task 2（配置存储）
  ↓
Task 4 (前端) ← 依赖 Task 2（API 端点）
  ↓
Task 5 (Pi 插件) ← 依赖 Task 1（core 已合并）可与 Task 4 并行
  ↓
Task 6 (测试 + 验证) ← 依赖所有前置 Task
```

**实际执行顺序：** Task 1 → Task 2 → Task 3 → Task 4 + Task 5 并行 → Task 6

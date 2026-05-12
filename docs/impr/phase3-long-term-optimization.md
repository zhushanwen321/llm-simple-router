# 第三阶段：长期优化

> 来源：feat-performance-impr 四维分析 | 预估工时：28.5h
> 优先级：长期规划

---

## 改进清单

### 后端架构（3 项）

#### 1. 格式转换层双向流式转换共享状态机基类（4h）

**问题**：`stream-ant2oa.ts`（207 行）和 `stream-oa2ant.ts`（212 行）两个方向的流式转换结构对称但独立维护。`stream-transform-base.ts` 已有 65 行基类，可进一步强化。

**方案**：提取共享状态机逻辑到基类，双向转换通过配置差异（如事件名映射、字段映射）而非独立实现。

**影响文件**：
- `router/src/proxy/transform/stream-transform-base.ts` — 强化基类
- `router/src/proxy/transform/stream-ant2oa.ts`
- `router/src/proxy/transform/stream-oa2ant.ts`
- `router/src/proxy/transform/stream-bridge-chat2resp.ts`（410 行）
- `router/src/proxy/transform/stream-bridge-resp2chat.ts`（249 行）

#### 2. 删除废弃 src/routing/ 目录（0.5h）

**问题**：`router/src/routing/` 目录存在但功能已迁移到 `proxy/routing/`，属废弃代码，容易导致开发者混淆。

**方案**：确认无引用后删除。

**影响文件**：
- `router/src/routing/` — 删除整个目录

#### 3. ServiceContainer 添加 dispose() 生命周期管理（2h）

**问题**：ServiceContainer 没有 `dispose()`/`close()` 方法，服务销毁逻辑散落在 `buildApp()` 返回的 `close()` 函数中。metadata key 不统一（部分用 SERVICE_KEYS 常量，部分用字符串字面量）。

**方案**：
1. 为 ServiceContainer 添加 `dispose()` 方法，遍历所有缓存实例并调用其 `close()`/`stop()` 方法（如果存在）
2. 将 `close()` 中散落的清理逻辑（`sessionTracker.stop()`、`logFileWriter?.stop()` 等）委托给容器
3. metadata key 统一使用 SERVICE_KEYS 常量

**影响文件**：
- `router/src/core/container.ts`
- `router/src/index.ts`

---

### 前端架构（2 项）

#### 4. Schedules.vue 拆分为 SchedulesList.vue + ScheduleDialog.vue（3h）

**问题**：`Schedules.vue` 544 行超过 `max-lines: 500` 限制，含大量重复模板。

**方案**：将 create/edit dialog 抽为独立组件。

**影响文件**：
- `frontend/src/views/Schedules.vue` — 拆分
- 新增：`frontend/src/components/schedules/ScheduleList.vue`
- 新增：`frontend/src/components/schedules/ScheduleDialog.vue`

#### 5. log-viewer/ 和 logs/ 目录合并（1h）

**问题**：`components/log-viewer/`（7 个组件）和 `components/logs/`（1 个组件）职责边界模糊——需要看代码才能区分前者是详情弹窗子组件，后者是列表行组件。

**方案**：合并为 `logs/` 目录，内部按 `list/` 和 `detail/` 子目录区分。

**影响文件**：
- `frontend/src/components/log-viewer/` — 移动到 `frontend/src/components/logs/detail/`
- `frontend/src/components/logs/` — 重命名为 `frontend/src/components/logs/list/`
- 更新所有 import 路径

---

### 后端性能（3 项）

#### 6. Worker Thread 隔离 SQLite（8h）

**问题**：`better-sqlite3` 同步操作阻塞事件循环是最大性能风险。高并发（200 QPS）下每秒 ~100-150ms 被同步 DB 写入独占。

**方案**：将 better-sqlite3 实例移到 Worker Thread，主线程通过 MessagePort 异步通信。项目中广泛使用 `getCachedStmt` 和 WeakMap，迁移工作量大但收益显著——彻底消除同步阻塞。

**注意**：需要将所有同步 DB 调用改为 `await dbWorker.postMessage()` 模式，API 层需要改为 async。

**影响文件**：
- 新增：`router/src/db/worker.ts` — Worker Thread 入口
- `router/src/db/index.ts` — 改为异步接口
- `router/src/db/*.ts` — 所有 DB 操作改为 async
- `router/src/proxy/log-helpers.ts` — insertRejectedLog 改为异步
- `router/src/proxy/handler/failover-loop.ts` — 日志写入调用点

#### 7. tool-mapper 转换结果缓存（2h）

**问题**：`tool-mapper.ts` 中的 tool definition 转换在每次请求时重新执行。同一个 client_model + provider 的转换结果理论上固定（tool definitions 不变时），对于包含数十个大型 tools 的请求，转换开销可能超过 5ms。

**方案**：以 client tools JSON hash + target API type 为 key 缓存转换结果，provider 配置变更时失效。

**影响文件**：
- `router/src/proxy/transform/tool-mapper.ts`
- `router/src/proxy/transform/format-registry.ts`

#### 8. HTTP Agent 按 provider host 独立创建（2h）

**问题**：当前所有无代理 provider 共享同一个全局 Agent（`maxSockets=50`）。不同 provider 的并发压力不同，共享 socket 池可能导致队头阻塞。

**方案**：为不同 provider host 创建独立的 Agent 实例，或使用更高的 `maxSockets` + `keepAliveMaxFreeSockets` 配置。

**影响文件**：
- `router/src/proxy/transport/http.ts` — ProxyAgentFactory 重构

---

### 前端性能（2 项）

#### 9. API 请求添加 AbortController 竞态处理（2h）

**问题**：Dashboard 的 `refresh()` 在快速切换 filter 时，旧请求仍在进行中且会覆盖新结果。`loadVersion` 计数器部分缓解了此问题，但 API 请求本身未被取消。Logs 页面的 filter 切换同样存在此问题。

**方案**：在发起新请求前取消旧请求，使用 AbortController + axios cancelToken。

**影响文件**：
- `frontend/src/composables/useDashboard.ts`
- `frontend/src/composables/useLogs.ts`
- `frontend/src/api/client.ts`

#### 10. 前端性能监控 — Web Vitals + Lighthouse CI（4h）

**问题**：完全缺失前端性能监控。无 Web Vitals（LCP、FID/INP、CLS）采集，无自定义性能埋点，无 Lighthouse CI 集成。性能评分仅 2/10。

**方案**：
1. 添加 `web-vitals` 库采集核心指标
2. CI 中集成 `lighthouse` 审计（通过 `lhci`）
3. 添加 `rollup-plugin-visualizer` 做 bundle 分析

**影响文件**：
- 新增：`frontend/src/utils/performance.ts`
- `frontend/vite.config.ts` — 添加 visualizer
- `.github/workflows/` — 添加 Lighthouse CI

---

## 工时汇总

| 项 | 工时 |
|----|------|
| 后端架构 | 6.5h |
| 前端架构 | 4h |
| 后端性能 | 12h |
| 前端性能 | 6h |
| **合计** | **28.5h** |

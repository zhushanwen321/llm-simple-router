# 实时监控仪表盘实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在管理后台新增实时监控页面，追踪活跃请求、并发度状态、统计指标，通过 SSE 推送实时更新。

**Architecture:** 新增 `RequestTracker` 内存单例，在 `proxy-core.ts` 的请求生命周期中埋点（start/update/complete）。SSE 端点定时（5s）广播状态给前端。前端双栏布局：左侧请求列表 + 右侧详情面板。

**Tech Stack:** Fastify SSE、perf_hooks、Vue 3 + shadcn-vue、EventSource API

**Spec:** `.superpowers/2026-04-20-monitor-metrics/spec.md`

---

## File Structure

### 新建文件

| 文件 | 职责 |
|------|------|
| `src/monitor/request-tracker.ts` | RequestTracker 核心类：活跃请求管理、统计聚合、SSE 广播 |
| `src/monitor/types.ts` | ActiveRequest、StatsSnapshot 等类型定义 |
| `src/monitor/stats-aggregator.ts` | Ring buffer 统计聚合器 |
| `src/monitor/runtime-collector.ts` | Node.js 运行时指标采集 |
| `src/admin/monitor.ts` | Fastify 插件：SSE stream + REST 端点 |
| `tests/monitor/request-tracker.test.ts` | RequestTracker 单元测试 |
| `tests/monitor/stats-aggregator.test.ts` | StatsAggregator 单元测试 |
| `tests/admin-monitor.test.ts` | SSE + REST 端点集成测试 |
| `frontend/src/views/Monitor.vue` | 监控主页面 |
| `frontend/src/components/monitor/MonitorHeader.vue` | 概览卡片 |
| `frontend/src/components/monitor/ActiveRequestList.vue` | 请求列表 |
| `frontend/src/components/monitor/RequestDetailPanel.vue` | 请求详情 |
| `frontend/src/components/monitor/ConcurrencyPanel.vue` | 并发度面板 |
| `frontend/src/components/monitor/RuntimePanel.vue` | 运行时面板 |
| `frontend/src/components/monitor/StatusCodePanel.vue` | 状态码分布 |
| `frontend/src/components/monitor/ProviderStatsTable.vue` | Provider 统计表 |
| `frontend/src/components/monitor/StreamResponseViewer.vue` | 流式响应查看器 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/metrics/sse-metrics-transform.ts` | 新增 `onMetrics` 回调参数 |
| `src/proxy/proxy-core.ts` | 在 handleProxyPost 中添加 tracker 埋点 |
| `src/admin/routes.ts` | 注册 monitor 路由 |
| `src/index.ts` | 初始化 RequestTracker 并注入 |
| `frontend/src/router/index.ts` | 添加 /monitor 路由 |
| `frontend/src/components/layout/Sidebar.vue` | 添加"实时监控"导航项 |
| `frontend/src/api/client.ts` | 添加 monitor API 方法 |

---

## Task 1: 类型定义

**Files:**
- Create: `src/monitor/types.ts`
- Test: `tests/monitor/types.test.ts`（验证导出，可选）

- [ ] **Step 1: 创建类型文件**

`src/monitor/types.ts` — 包含 spec-data-model.md 中定义的所有接口：

```typescript
// ActiveRequest, AttemptSnapshot, StreamMetricsSnapshot,
// ProviderConcurrencySnapshot, StatsSnapshot, ProviderStats,
// RuntimeMetrics
```

类型直接从 spec-data-model.md 复制，`status` 为 `"pending" | "completed" | "failed"`（无 retrying）。

- [ ] **Step 2: Commit**

```bash
git add src/monitor/types.ts
git commit -m "feat(monitor): add monitor type definitions"
```

---

## Task 2: StatsAggregator — 统计聚合器

**Files:**
- Create: `src/monitor/stats-aggregator.ts`
- Create: `tests/monitor/stats-aggregator.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/monitor/stats-aggregator.test.ts`：
- `recordLatency()` 记录延迟到 ring buffer
- `getStats()` 返回 `StatsSnapshot`（含 p50/p99/avg）
- `recordRequest()` 按 provider 和 statusCode 分类计数
- ring buffer 满时覆盖最旧数据

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/monitor/stats-aggregator.test.ts
```

- [ ] **Step 3: 实现 StatsAggregator**

`src/monitor/stats-aggregator.ts`：
- Ring buffer 默认容量 1000
- `recordLatency(ms: number)` — 追加到 buffer
- `recordRequest(providerId: string, statusCode: number, isRetry: boolean, isFailover: boolean)` — 累加计数器
- `getStats()` — 从 buffer 计算分位数，从计数器构建 `StatsSnapshot`
- `reset()` — 清空所有数据

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/monitor/stats-aggregator.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/monitor/stats-aggregator.ts tests/monitor/stats-aggregator.test.ts
git commit -m "feat(monitor): implement StatsAggregator with ring buffer"
```

---

## Task 3: RuntimeCollector — 运行时指标

**Files:**
- Create: `src/monitor/runtime-collector.ts`
- Create: `tests/monitor/runtime-collector.test.ts`

- [ ] **Step 1: 写冒烟测试**

`tests/monitor/runtime-collector.test.ts`：
- 验证 `collect()` 返回的 `RuntimeMetrics` 结构符合接口定义
- 验证 `uptimeMs > 0`、`memoryUsage.rss > 0`、`activeHandles >= 0`

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/monitor/runtime-collector.test.ts
```

- [ ] **Step 3: 实现 RuntimeCollector**

`src/monitor/runtime-collector.ts`：
- `collect(): RuntimeMetrics` — 采集一次运行时快照
- `start()` / `stop()` — 启停 `perf_hooks.monitorEventLoopDelay`
- 字段：`uptimeMs`（process.uptime()）、`memoryUsage`（process.memoryUsage()）、`activeHandles`（`process._getActiveHandles().length`）、`activeRequests`（`process._getActiveRequests().length`）、`eventLoopDelayMs`（histogram.mean，纳秒→毫秒）

如果 `monitorEventLoopDelay` 不可用，`eventLoopDelayMs` 返回 0。

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/monitor/runtime-collector.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/monitor/runtime-collector.ts tests/monitor/runtime-collector.test.ts
git commit -m "feat(monitor): implement RuntimeCollector"
```

---

## Task 4: RequestTracker — 核心类

**Files:**
- Create: `src/monitor/request-tracker.ts`
- Create: `tests/monitor/request-tracker.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/monitor/request-tracker.test.ts`：
- `start()` 添加请求到 activeMap
- `update()` 修改活跃请求的字段
- `complete()` 将请求移到 recentCompleted
- `getActive()` 只返回 status=pending 的请求
- `getRecent()` 返回最近完成的请求，按 completedAt 降序
- `addClient()` / `removeClient()` 管理 SSE 连接
- `broadcast()` 向所有客户端写入 SSE 消息
- `startPushInterval()` 启动 5s 定时器，广播 request_update + concurrency_update + stats_update，每 10s 附带 runtime_update

注入 in-memory StatsAggregator 和 mock RuntimeCollector。

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/monitor/request-tracker.test.ts
```

- [ ] **Step 3: 实现 RequestTracker**

`src/monitor/request-tracker.ts`：
- 依赖 `StatsAggregator`、`RuntimeCollector`、`ProviderSemaphoreManager`
- `activeMap: Map<string, ActiveRequest>` — 活跃请求
- `recentCompleted: ActiveRequest[]` — 最近完成，上限 200，保留 5 分钟
- `clients: Set<ServerResponse>` — SSE 连接集合
- `providerConfigCache: Map<string, {...}>` — 缓存 provider 配置，`updateProviderConfig()` 时更新
- `startPushInterval()` / `stopPushInterval()` — 定时广播
- `broadcast()` 实现：遍历 clients，try-catch 写入
- `getConcurrency()` 组合 `semaphoreManager.getStatus()` + providerConfigCache

构造函数接收 `{ semaphoreManager, runtimeCollector }` 可选依赖。

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/monitor/request-tracker.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/monitor/request-tracker.ts tests/monitor/request-tracker.test.ts
git commit -m "feat(monitor): implement RequestTracker with SSE broadcast"
```

---

## Task 5: SSEMetricsTransform onMetrics 回调

**Files:**
- Modify: `src/metrics/sse-metrics-transform.ts`
- Modify: `tests/metrics-extractor.test.ts` 或 `tests/sse-parser.test.ts`（确认不破坏现有测试）

- [ ] **Step 1: 写失败测试**

新增测试：验证 `onMetrics` 回调在处理 SSE 事件后被调用，且带节流（5s 内同一 transform 只回调一次）。

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/sse-parser.test.ts
```

- [ ] **Step 3: 修改 SSEMetricsTransform**

在构造函数中新增可选的 `onMetrics` 回调参数：

```typescript
export interface MetricsTransformOptions {
  onMetrics?: (metrics: MetricsResult) => void;
  throttleMs?: number; // 默认 5000
}

constructor(apiType, requestStartTime, options?: MetricsTransformOptions)
```

在 `_transform` 中，每次调用 `extractor.processEvent()` 后，检查节流时间是否已过，如果已过则调用 `onMetrics(extractor.getMetrics())`。在 `_flush` 中无条件调用一次（确保最终状态被推送）。

注意：`MetricsResult`（来自 `metrics-extractor.ts`）需要映射为 `StreamMetricsSnapshot`（在 Task 6 的埋点层做映射，transform 只传原始 `MetricsResult`）。

- [ ] **Step 4: 运行全部相关测试确认通过**

```bash
npx vitest run tests/sse-parser.test.ts tests/metrics-extractor.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/metrics/sse-metrics-transform.ts tests/
git commit -m "feat(monitor): add onMetrics callback to SSEMetricsTransform"
```

---

## Task 6: proxy-core.ts 埋点

**Files:**
- Modify: `src/proxy/proxy-core.ts`
- Modify: `src/proxy/openai.ts`（传递 tracker 到 handleProxyPost 的 deps）
- Modify: `src/proxy/anthropic.ts`（同上）

- [ ] **Step 1: 在 ProxyHandlerDeps 中添加 tracker**

`src/proxy/proxy-core.ts` — 在 `ProxyHandlerDeps` 接口添加：

```typescript
tracker?: RequestTracker;
```

- [ ] **Step 2: 在 handleProxyPost 中添加埋点**

在以下位置插入 tracker 调用：

1. 请求入口（`resolveMapping` 成功后、semaphore acquire 前）：
```typescript
deps.tracker?.start({ id: logId, apiType, model: effectiveModel, providerId: resolved.provider_id, providerName: provider.name, isStream, startTime, status: "pending", retryCount: 0, attempts: [], clientIp: request.ip });
```

2. semaphore acquire 失败（catch 块中）：
```typescript
deps.tracker?.complete(logId, { status: "failed", statusCode: e.statusCode });
```

3. retryableCall 返回后（attempts 循环前）：
```typescript
const streamMetrics = isStream ? mapMetricsResultToStreamSnapshot(r) : undefined;
deps.tracker?.update(logId, { retryCount: attempts.length - 1, attempts: attempts.map(mapAttempt), providerId: provider.id, streamMetrics });
```

**重要**：`onMetrics` 实时回调的接入。在 `retryableCall` 的闭包函数内构造 `SSEMetricsTransform` 时，必须传入 `onMetrics` 回调：
```typescript
// 流式分支的 retryableCall 闭包内：
const metricsTransform = new SSEMetricsTransform(apiType, startTime, {
  onMetrics: (m) => deps.tracker?.update(logId, { streamMetrics: mapMetricsResultToStreamSnapshot(m) }),
});
```
注意 `logId` 在闭包中捕获的是 while 循环顶部的值，failover 时 while 继续→logId 会变化，但旧 logId 已在 continue 前 complete 掉了，所以不会错乱。

4. 成功/失败出口（各 return 前）：
```typescript
deps.tracker?.complete(logId, { status: r.statusCode < 400 ? "completed" : "failed", statusCode: r.statusCode });
```

5. catch 块中异常出口：
```typescript
deps.tracker?.complete(logId, { status: "failed", statusCode: HTTP_BAD_GATEWAY });
```

6. **failover continue 路径**（两处）：在 `releaseSemaphore(); excludeTargets.push(resolved); continue;` 前添加：
```typescript
deps.tracker?.complete(logId, { status: "failed", statusCode: r.statusCode }); // 成功路径的 failover
deps.tracker?.complete(logId, { status: "failed" }); // catch 路径的 failover
```
这两处 continue 会重新进入 while 循环生成新 logId，当前 logId 的请求必须被标记为 failed，否则 activeMap 会残留泄漏。

- [ ] **Step 3: 在 openai.ts / anthropic.ts 中传递 tracker**

两个代理插件的 `options` 中解构 `tracker`，传入 `handleProxyPost` 的 `deps`。

- [ ] **Step 4: 运行现有代理测试确认不破坏**

```bash
npx vitest run tests/openai-proxy.test.ts tests/anthropic-proxy.test.ts tests/integration.test.ts tests/proxy-semaphore.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/proxy/proxy-core.ts src/proxy/openai.ts src/proxy/anthropic.ts
git commit -m "feat(monitor): add RequestTracker instrumentation to proxy-core"
```

---

## Task 7: Admin Monitor API

**Files:**
- Create: `src/admin/monitor.ts`
- Create: `tests/admin-monitor.test.ts`
- Modify: `src/admin/routes.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: 实现 monitor.ts Fastify 插件**

`src/admin/monitor.ts`：

REST 端点：
- `GET /admin/api/monitor/active` → `tracker.getActive()`
- `GET /admin/api/monitor/stats` → `tracker.getStats()`
- `GET /admin/api/monitor/concurrency` → `tracker.getConcurrency()`
- `GET /admin/api/monitor/runtime` → `tracker.getRuntime()`

SSE 端点：
- `GET /admin/api/monitor/stream` — 设置 `Content-Type: text/event-stream`，禁用缓冲（`reply.raw.writeHead` + `Connection: keep-alive`），调用 `tracker.addClient(reply.raw)`，请求关闭时 `tracker.removeClient(reply.raw)`

- [ ] **Step 2: 写集成测试**

`tests/admin-monitor.test.ts`：
- 验证 REST 端点返回正确数据格式
- 验证 SSE 连接建立后能收到定时推送
- 使用 `buildApp({ db: inMemoryDb })` 注入测试数据库

- [ ] **Step 3: 在 routes.ts 中注册**

`src/admin/routes.ts` — 导入 `adminMonitorRoutes`，在 `adminRoutes` 中注册：

```typescript
app.register(adminMonitorRoutes, { tracker: options.tracker });
```

在 `AdminRoutesOptions` 接口中添加 `tracker?: RequestTracker`。

**认证说明**：`monitor.ts` 注册在 `adminRoutes` 内部（`adminAuthPlugin` 之后），所有端点（包括 SSE stream）自动继承 admin JWT Cookie 认证，无需额外配置。前端使用原生 `EventSource`，Cookie 会被浏览器自动携带。

- [ ] **Step 4: 在 index.ts 中初始化并注入**

`src/index.ts` — 在 `buildApp()` 中：

```typescript
import { RequestTracker } from "./monitor/request-tracker.js";
const tracker = new RequestTracker({ semaphoreManager });
// provider 配置缓存：遍历 providers 填充
for (const p of providers) {
  tracker.updateProviderConfig(p.id, { name: p.name, maxConcurrency: p.max_concurrency, ... });
}
tracker.startPushInterval();
```

传递 `tracker` 到 `openaiProxy`、`anthropicProxy`、`adminRoutes` 的 options。

**provider 配置缓存同步**：在 `admin-providers.ts` 的 CRUD 操作（create/update/delete）后，需要调用 `tracker.updateProviderConfig()` 或 `tracker.removeProviderConfig()` 同步缓存。如果 `admin-providers.ts` 已经有 `semaphoreManager.updateConfig()` 调用，在同一位置添加 tracker 缓存更新即可。

- [ ] **Step 5: 运行测试确认通过**

```bash
npx vitest run tests/admin-monitor.test.ts tests/admin-providers.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/admin/monitor.ts src/admin/routes.ts src/index.ts tests/admin-monitor.test.ts
git commit -m "feat(monitor): add monitor admin API with SSE stream"
```

---

## Task 8: 前端路由 + 导航 + API 客户端

**Files:**
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/components/layout/Sidebar.vue`
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: 添加路由**

`frontend/src/router/index.ts` — 添加：

```typescript
{ path: '/monitor', name: 'monitor', component: () => import('@/views/Monitor.vue'), meta: { requiresAuth: true } }
```

放在 `/logs` 之后。

- [ ] **Step 2: 添加导航项**

`frontend/src/components/layout/Sidebar.vue` — 在 `navItems` 数组中，`logs` 项之前添加：

```typescript
{ path: '/monitor', label: '实时监控', icon: Activity }
```

从 `lucide-vue-next` 导入 `Activity`。

- [ ] **Step 3: 添加 API 方法**

`frontend/src/api/client.ts` — 在 `API` 常量中添加：

```typescript
MONITOR_ACTIVE: '/monitor/active',
MONITOR_STATS: '/monitor/stats',
MONITOR_CONCURRENCY: '/monitor/concurrency',
MONITOR_RUNTIME: '/monitor/runtime',
MONITOR_STREAM: '/monitor/stream',
```

添加对应 API 方法（getMonitorActive, getMonitorStats 等）。

- [ ] **Step 4: 验证前端构建**

```bash
cd frontend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/router/index.ts frontend/src/components/layout/Sidebar.vue frontend/src/api/client.ts
git commit -m "feat(monitor): add route, nav item, and API client"
```

---

## Task 9: 前端 Monitor 页面骨架

**Files:**
- Create: `frontend/src/views/Monitor.vue`

- [ ] **Step 1: 创建 Monitor.vue**

双栏布局容器，组合以下组件：
- 顶部 `MonitorHeader`（概览卡片）
- 左侧 `ActiveRequestList`
- 右侧 `RequestDetailPanel`
- 底部 `ProviderStatsTable`

SSE 连接逻辑：
- `onMounted` → 调 REST API 获取初始快照 → 建立 `EventSource('/admin/api/monitor/stream')`
- 监听 SSE 事件更新响应式状态
- `onUnmounted` → 关闭 `EventSource`

先创建骨架，各子组件用占位 div，后续 Task 逐个实现。

- [ ] **Step 2: 验证页面可访问**

```bash
cd frontend && npm run dev
# 访问 http://localhost:5173/admin/monitor
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/Monitor.vue
git commit -m "feat(monitor): add Monitor page skeleton with SSE connection"
```

---

## Task 10: MonitorHeader + ConcurrencyPanel + RuntimePanel + StatusCodePanel

**Files:**
- Create: `frontend/src/components/monitor/MonitorHeader.vue`
- Create: `frontend/src/components/monitor/ConcurrencyPanel.vue`
- Create: `frontend/src/components/monitor/RuntimePanel.vue`
- Create: `frontend/src/components/monitor/StatusCodePanel.vue`

- [ ] **Step 1: 实现 MonitorHeader**

4 张概览卡片：活跃请求数（流式/非流式拆分）、错误率、P50 延迟、重试率。参考 `mockup-overview.html`。

使用 shadcn-vue 的 `Card`、`Badge` 组件。

- [ ] **Step 2: 实现 ConcurrencyPanel**

每个 provider 一行：名称、active/max 进度条、排队数、队列上限。未限制的 provider 显示"未限制"。参考 `mockup-overview.html` 右侧面板。

- [ ] **Step 3: 实现 RuntimePanel**

运行时间、内存 RSS、堆使用（带进度条）、活跃 Handles/Requests、事件循环延迟。

- [ ] **Step 4: 实现 StatusCodePanel**

按 2xx/4xx/429/5xx 分类的进度条 + 计数。

- [ ] **Step 5: 验证前端构建**

```bash
cd frontend && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/monitor/
git commit -m "feat(monitor): add header, concurrency, runtime, and status code panels"
```

---

## Task 11: ActiveRequestList + RequestDetailPanel

**Files:**
- Create: `frontend/src/components/monitor/ActiveRequestList.vue`
- Create: `frontend/src/components/monitor/RequestDetailPanel.vue`

- [ ] **Step 1: 实现 ActiveRequestList**

参考 `mockup-detail.html` 左侧面板：
- 活跃请求列表（状态 badge + 模型名 + provider + 耗时 + 流指标）
- 虚线分隔后是"最近完成"（灰显）
- 点击请求项 → emit `select` 事件

- [ ] **Step 2: 实现 RequestDetailPanel**

参考 `mockup-detail.html` 右侧面板：
- 请求头信息（模型 + 状态 badge + ID）
- 6 列指标网格（API 类型、Provider、耗时、TTFT、输出 Tokens、速度）
- `StreamResponseViewer` 占位（下一个 Task 实现）
- 重试历史（AttemptsSnapshot 列表）
- 客户端请求 / 上游请求（折叠，Raw JSON 查看）

当没有选中请求时显示"选择一个请求查看详情"。

- [ ] **Step 3: 验证前端构建**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/monitor/ActiveRequestList.vue frontend/src/components/monitor/RequestDetailPanel.vue
git commit -m "feat(monitor): add active request list and detail panel"
```

---

## Task 12: StreamResponseViewer + ProviderStatsTable

**Files:**
- Create: `frontend/src/components/monitor/StreamResponseViewer.vue`
- Create: `frontend/src/components/monitor/ProviderStatsTable.vue`

- [ ] **Step 1: 实现 StreamResponseViewer**

参考 `mockup-detail.html` 的三种视图模式：
- **组装视图**（默认）：按 content block 分组展示（thinking/text），用不同颜色的左边框区分
- **事件流**：按 SSE 事件类型分色显示，连续同类事件可折叠
- **原始 SSE**：深色背景 + 等宽字体，显示原始 event/data

由于监控的 SSE 推送不含完整流内容（只含 StreamMetricsSnapshot 汇总），这个组件暂时只展示汇总指标（tokens、TTFT、速度）。完整流内容查看需要后续增强（记录 SSE 事件到 tracker），当前版本用指标卡片 + 状态文字代替。

- [ ] **Step 2: 实现 ProviderStatsTable**

参考 `mockup-overview.html` 底部表格：
- 列：Provider、请求数、成功率、平均延迟、P99 延迟、重试率、状态码分布（badge 列表）

- [ ] **Step 3: 验证前端构建 + 页面完整**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/monitor/StreamResponseViewer.vue frontend/src/components/monitor/ProviderStatsTable.vue
git commit -m "feat(monitor): add stream viewer and provider stats table"
```

---

## Task 13: 端到端验证

**Files:** 无新文件

- [ ] **Step 1: 运行全部后端测试**

```bash
npm test
```

确认所有测试通过，包括新增的 monitor 测试和现有测试无回归。

- [ ] **Step 2: 启动后端 + 前端，手动验证**

```bash
# 终端 1
npm run dev

# 终端 2
cd frontend && npm run dev
```

验证：
1. 访问 `/admin/monitor`，页面正常加载
2. 发送几个代理请求，观察活跃请求列表更新
3. 观察 SSE 连接状态（Network 面板看到 5s 间隔的推送）
4. 并发度面板显示正确的 active/queued
5. Provider 统计表显示正确数据

- [ ] **Step 3: Final commit（如有修复）**

```bash
git add -A
git commit -m "fix(monitor): e2e verification fixes"
```

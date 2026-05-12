# Monitor 页面性能优化 Spec

## 目标

将 Monitor 页面的 Chrome 内存占用从 >1GB 降至 <50MB（10 个并发流式请求场景），核心手段是将流式内容从"全量广播"改为"按需获取"。

## 背景

当前架构下，后端 `RequestTracker` 每 500ms 通过 SSE `stream_content_update` 事件推送**所有**活跃流式请求的完整 `StreamContentSnapshot`（含 rawChunks 128KB + textContent 64KB + blocks N×64KB）。10 个并发请求产生 ~8.5MB/s 的 SSE 带宽，前端 V8 的增量 GC 跟不上对象创建速度，堆内存持续膨胀至 >1GB。

核心矛盾：流式内容仅在被用户点击查看的那 1 条请求中需要，但当前为所有请求全量推送。利用率 ~10%，浪费 90%。

## 方案

### 核心变更：流式内容按需获取

**当前数据流**：

```
StreamContentAccumulator (后端, 每请求)
  → getSnapshot() → { rawChunks, textContent, blocks } (~384KB/请求)
  → scheduleStreamContentPush (500ms)
  → broadcast("stream_content_update", [所有请求的完整 snapshot])
  → SSE → 前端 JSON.parse → activeRequests[i].streamContent = full
```

**改后数据流**：

```
后端 StreamContentAccumulator (不变)
  → flushStreamContentPush (500ms)
  → broadcast("stream_content_update", [轻量摘要])  ← 只推 {id, totalChars, streamMetrics}
  → SSE → 前端更新列表页的进度指标

用户点击请求 → 前端 selectRequest(id)
  → 启动 500ms 轮询 GET /admin/api/monitor/request/:id  ← 已有端点
  → 获取完整 streamContent → 更新详情对话框
  → 请求完成或切换选择 → 停止轮询
```

### 具体变更

#### 后端（3 项）

**B1. `stream_content_update` 改为轻量摘要推送**

文件：`router/src/core/monitor/request-tracker.ts` — `flushStreamContentPush()`

当前推送：
```typescript
updates.push({ id, streamContent: req.streamContent ?? null, streamMetrics: req.streamMetrics ?? null })
```

改为推送：
```typescript
updates.push({
  id,
  totalChars: req.streamContent?.totalChars ?? 0,
  streamMetrics: req.streamMetrics ?? null,
})
```

`streamMetrics` 保留（< 200 bytes，含 outputTokens/tokensPerSecond/ttftMs，列表页需要展示）。
`streamContent`（128KB+）不再推送。

**B2. 所有 SSE 广播事件 strip `streamContent` + `streamMetrics`**

文件：`router/src/core/monitor/request-tracker.ts` — `broadcast()`

对所有包含 ActiveRequest 的 SSE 事件（`request_update`、`request_start`、`request_complete`）strip `streamContent`/`streamMetrics`。`request_complete` 保留 `streamMetrics`（最终指标，前端列表需要展示）。

```typescript
// request_update: strip 全部大字段
if (event === "request_update" && Array.isArray(data)) {
  payload = data.map((req) => {
    const copy = { ...req };
    delete copy.clientRequest;
    delete copy.upstreamRequest;
    delete copy.streamContent;
    delete copy.streamMetrics;
    return copy;
  });
}
// request_start / request_complete: strip streamContent，保留 streamMetrics
else if ((event === "request_complete" || event === "request_start") && data && typeof data === "object") {
  const copy = { ...(data as ActiveRequest) };
  delete copy.clientRequest;
  delete copy.upstreamRequest;
  delete copy.streamContent;
  payload = copy;
}
```

`sendInitialSnapshot()` 同样 strip `streamContent`/`streamMetrics`。

**B3. 降低 `StreamContentAccumulator` 缓冲区上限 + 完成时清理**

文件：`router/src/core/monitor/stream-content-accumulator.ts`

- `DEFAULT_MAX_RAW`: 131072 (128KB) → 32768 (32KB)
- `DEFAULT_MAX_TEXT`: 65536 (64KB) → 16384 (16KB)

文件：`router/src/core/monitor/request-tracker.ts` — `complete()`

完成请求时清除 `streamContent`，避免 200 条 recentCompleted 各自携带巨大 snapshot：
```typescript
const completed: ActiveRequest = {
  ...rest,
  status: wasKilled ? "failed" : result.status,
  completedAt: now,
  attempts: result.attempts ?? req.attempts,
  streamContent: undefined,   // 新增：完成即清除
};
```

#### 前端（4 项）

**F1. `stream_content_update` handler 改为轻量更新**

文件：`frontend/src/composables/useMonitorData.ts`

当前 handler 直接 mutate `req.streamContent = update.streamContent`。
改为更新轻量字段：
```typescript
case 'stream_content_update': {
  const updates = data as Array<{ id: string; totalChars: number; streamMetrics: StreamMetricsSnapshot | null }>
  for (const update of updates) {
    const req = activeRequests.value.find((r) => r.id === update.id)
    if (req) {
      req.streamTotalChars = update.totalChars  // 新增轻量字段
      if (update.streamMetrics) req.streamMetrics = update.streamMetrics
    }
  }
  triggerRef(activeRequests)
  break
}
```

**F2. 选中请求时按需轮询获取 streamContent**

文件：`frontend/src/composables/useMonitorData.ts`

新增 `selectedStreamContent` ref 和轮询逻辑：
- `selectRequest(id)` 时启动 500ms 间隔调用 `GET /admin/api/monitor/request/:id`
- 响应的 `streamContent` 写入 `selectedStreamContent`
- 请求完成（通过 SSE `request_complete` 检测到 status 变化）时停止轮询
- 切换选择时停止旧轮询、启动新轮询
- `onUnmounted` 清理轮询定时器

`activeRequests` 中的 `streamContent` 字段不再被 SSE 填充，`selectedRequest.computed` 仍可访问，但详情对话框改为读取 `selectedStreamContent`。

**F3. Monitor.vue TooltipProvider 共享**

文件：`frontend/src/views/Monitor.vue`

当前每行 2 个 `<TooltipProvider>`（复制 + Kill 按钮）。将 `<TooltipProvider>` 提升到三个 `<ScrollArea>` 的父级，所有 Tooltip 共享一个 Provider。

**F4. visibilitychange 监听 + now 定时器优化**

文件：`frontend/src/composables/useMonitorSSE.ts`

添加 `document.visibilitychange` 监听：
- 页面隐藏 > 30s 后断开 SSE 连接
- 页面恢复时重连

文件：`frontend/src/views/Monitor.vue`

`now` 定时器仅在页面可见时运行（配合 visibility change）。

## 数据流

### 新增数据字段

| 字段 | 类型 | 生产者 | 存储位置 | 消费者 | 读取时机 |
|------|------|--------|---------|--------|----------|
| streamTotalChars | number | SSE stream_content_update | 前端 activeRequests 内存 | Monitor.vue 列表行 | 实时 |
| selectedStreamContent | StreamContentSnapshot \| null | HTTP GET /admin/api/monitor/request/:id | 前端 composable 内存 | UnifiedRequestDialog.vue → ResponseViewer.vue | 按需（选中时轮询） |

### 改后数据流图

```
后端 StreamContentAccumulator
  → flushStreamContentPush (500ms)
  → broadcast("stream_content_update", [轻量摘要]) → SSE → 前端列表进度

用户点击请求 → selectRequest(id)
  → GET /admin/api/monitor/request/:id (500ms 轮询)
  → 后端 tracker.getRequestById(id) → 返回完整 streamContent
  → 前端 selectedStreamContent → 详情对话框渲染

请求完成 → SSE request_complete → 停止轮询 → loadLogDetail(DB)
```

### 时序要求

- `stream_content_update`（轻量）继续 500ms 推送，用于列表页进度展示
- HTTP 轮询在 selectRequest 后立即启动，间隔 500ms
- 请求完成后停止轮询，切换为 DB 日志加载

## 已有基础设施

### 可复用的现有 API

| 位置 | 方法 | 用途 |
|------|------|------|
| `router/src/admin/monitor.ts` | `GET /admin/api/monitor/request/:id` | 已有端点，调用 `tracker.getRequestById(id)` 返回完整 ActiveRequest（含 streamContent），无需新增端点 |
| `router/src/core/monitor/request-tracker.ts` | `getRequestById(id)` | 已有方法，先查 activeMap 再查 recentCompleted + completedDetails 合并 |
| `frontend/src/api/client.ts` | `api.getMonitorRequest(id)` | 已有 API 方法 |

### 接口/类型定义位置

| 位置 | 接口名 | 用途 |
|------|--------|------|
| `frontend/src/types/monitor.ts` | `ActiveRequest`, `StreamContentSnapshot`, `StreamMetricsSnapshot` | 监控页类型定义 |
| `router/src/core/monitor/types.ts` | `ActiveRequest`, `StreamContentSnapshot` | 后端类型定义 |
| `router/src/core/monitor/stream-content-accumulator.ts` | `DEFAULT_MAX_RAW`, `DEFAULT_MAX_TEXT` | 缓冲区上限常量 |

### 已知技术债务（编码 agent 不修）

| 文件 | 问题 | 原因 |
|------|------|------|
| `useMonitorData.ts` | `shallowRef` + `triggerRef` 模式脆弱 | 预存问题，非本次引入 |
| `useMonitorSSE.ts` | `onClose` 可能被调用两次 | 预存问题，非本次引入 |

## 验收标准

### AC1: SSE 带宽降低 95%+
- 10 个并发流式请求场景下，SSE 带宽从 ~8.5MB/s 降至 < 100KB/s
- `stream_content_update` 每条消息 < 300 bytes（不含 streamContent）
- `request_update` 不含 streamContent 和 streamMetrics

### AC2: 前端内存 < 50MB
- Chrome DevTools Heap Snapshot 显示 Monitor 页面 JS 堆 < 50MB（10 并发流式请求）
- 对比优化前 >1GB，降低 95%+

### AC3: 流式内容正常展示
- 点击任意活跃流式请求，详情对话框实时展示流式内容（rawChunks + textContent + blocks）
- 内容更新延迟 < 1s（500ms 轮询间隔 + 网络延迟）
- 请求完成后内容完整保留（从 DB 加载）

### AC4: 轻量进度指标正常
- 列表页每个活跃流式请求行显示 totalChars 数字（通过轻量 stream_content_update）
- 列表页每个活跃流式请求行显示 streamMetrics 指标（tokensPerSecond、outputTokens）
- Monitor.vue 活跃请求行新增 totalChars 和 streamMetrics 展示 UI

### AC5: 页面不可见时断开 SSE
- 切换到其他标签页 > 30s 后，SSE 连接断开
- 切回时自动重连

### AC6: 现有功能不受影响
- 活跃请求列表、队列请求列表、已完成列表正常显示
- Kill 请求功能正常
- 并发面板、状态码面板、运行时面板正常更新
- Provider 统计表正常

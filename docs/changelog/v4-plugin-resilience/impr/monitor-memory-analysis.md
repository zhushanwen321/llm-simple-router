# Monitor 页面内存占用分析

> 分析日期：2026-05-12 | Chrome 任务管理器报告 >1GB

---

## 现象

打开 `http://localhost:9981/admin/monitor` 后，Chrome 任务管理器显示该标签页内存占用超过 1GB。

---

## 根因分析

### 1. 后端 `stream_content_update` SSE 事件每 500ms 推送大量数据（主因）

**数据链路**：

```
StreamContentAccumulator.append(rawLine)
  → rawChunks += rawLine (max 128KB)
  → textContent += text (max 64KB)
  → blocks[i].content += content (每个 block max 64KB)
  → getSnapshot() → { rawChunks, textContent, totalChars, blocks }
```

**每个活跃流式请求的 `StreamContentSnapshot` 最大体积**：

| 字段 | 上限 |
|------|------|
| `rawChunks` | 128KB |
| `textContent` | 64KB |
| `blocks` (N 个) | N × 64KB |

单个请求（含 3 个 content blocks：thinking + text + tool_use）的 snapshot 约 **384KB**。

**广播频率**：`scheduleStreamContentPush()` 每 500ms 批量推送所有变更请求的 snapshot。

**前端接收后全量替换**：`useMonitorData.ts` 的 `stream_content_update` handler 直接 mutate `activeRequests[i].streamContent = update.streamContent`，旧 snapshot 成为 GC 垃圾。

**内存放大效应**：

假设 10 个并发流式请求：
- 后端每 500s 推送：10 × ~384KB = **3.84MB/次**，每秒 2 次 = **7.68MB/s**
- 前端 JSON.parse 解析 + Vue 响应式系统保留新旧引用
- V8 的 GC 是增量式的，在高频分配场景下跟不上对象创建速度，导致堆内存持续膨胀

### 2. `request_update` 每 5s 广播全量活跃请求列表

`request-tracker.ts` 的 `startPushInterval()` 中：

```typescript
if (this.requestUpdateDirty) {
  this.broadcast("request_update", this.getActive());
  this.requestUpdateDirty = false;
}
```

`getActive()` 返回所有活跃请求（含 `streamContent`），broadcast 时虽然 strip 了 `clientRequest` 和 `upstreamRequest`，但 `streamContent` 保留了。

**影响**：10 个流式请求 × ~384KB = 3.84MB 的 JSON，每 5s 序列化一次并通过 SSE 推送。前端 `request_update` handler 直接替换整个数组 `activeRequests.value = data as ActiveRequest[]`，造成大量临时对象分配。

### 3. 前端 `now` 定时器触发全量行重渲染（次要）

```typescript
// Monitor.vue
const now = ref(Date.now())
tickTimer = setInterval(() => { now.value = Date.now() }, 3000)
```

模板中每一行都调用 `elapsed(req.startTime)`。每 3 秒 `now` 变化时，**所有活跃请求行**（含 TooltipProvider 等深层组件树）都会重新渲染。

### 4. 每行 2 个 `TooltipProvider` 实例（次要）

Monitor.vue 的三列（活跃、队列、已完成）中，每行都内嵌了 2 个 `<TooltipProvider>`：

```html
<TooltipProvider :delay-duration="300">
  <Tooltip>...</Tooltip>  <!-- 复制按钮 -->
</TooltipProvider>
<TooltipProvider :delay-duration="300">
  <Tooltip>...</Tooltip>  <!-- Kill 按钮 -->
</TooltipProvider>
```

`TooltipProvider` 是 Radix Vue 的 Context Provider，每个实例创建独立的 tooltip 状态管理。100 个请求 × 3 列 × 2 个 Provider = **600 个 TooltipProvider 实例**。

### 5. `recentCompleted` 保留 200 条完整请求（前端 + 后端）

前端 `useMonitorData.ts`：

```typescript
recentCompleted.value.unshift(completed)
if (recentCompleted.value.length > RECENT_COMPLETED_MAX) {
  recentCompleted.value.length = RECENT_COMPLETED_MAX
}
```

后端 `request-tracker.ts` 的 `complete()` 虽然已经将 `clientRequest`/`upstreamRequest` 分离到 `completedDetails`，但 `recentCompleted` 仍保留了请求的其他所有字段（含 `streamContent`、`attempts`、`streamMetrics`）。

**注意**：后端 `complete()` 中 `req.streamContent` 保留了最后的 snapshot（128KB rawChunks + 64KB textContent + blocks），200 条 × 192KB = **38.4MB**（后端内存），但前端 `request_complete` 广播时也包含这些数据。

### 6. 后端 `request_update` 广播未 strip `streamContent`

`broadcast()` 方法中：

```typescript
if (event === "request_update" && Array.isArray(data)) {
  payload = data.map((req: ActiveRequest) => {
    const copy = { ...req };
    delete copy.clientRequest;
    delete copy.upstreamRequest;
    return copy;
  });
}
```

只删了 `clientRequest` 和 `upstreamRequest`，**没删 `streamContent`**。而 `streamContent` 是每 500ms 已经由 `stream_content_update` 独立推送的。`request_update` 再带一遍是**冗余传输**，且数据量巨大。

---

## 内存占用估算

### 场景：10 个并发流式请求

| 数据源 | 单次大小 | 频率 | 带宽/秒 |
|--------|---------|------|---------|
| `stream_content_update` | 10 × 384KB = 3.84MB | 每 500ms | 7.68 MB/s |
| `request_update`（冗余 streamContent） | 10 × 384KB = 3.84MB | 每 5s | 0.77 MB/s |
| `stats_update` | ~2KB | 每 5s | 0.4 KB/s |
| `concurrency_update` | ~1KB | 每 5s | 0.2 KB/s |
| `runtime_update` | ~0.5KB | 每 10s | 0.05 KB/s |

**峰值 SSE 带宽：~8.5 MB/s**，全是 JSON 文本。

前端 V8 引擎需要：
- 对每个 SSE event 执行 `JSON.parse()`（分配临时对象）
- Vue 响应式系统追踪新对象，旧对象进入 GC 队列
- `shallowRef` 的 `triggerRef()` 触发所有消费者重新计算

在高频 8.5MB/s 的 JSON 解析 + 对象分配压力下，V8 的增量 GC（约每 1-2ms 做一小步）跟不上，导致堆持续膨胀，Chrome 任务管理器显示 >1GB。

---

## 修复建议（按优先级）

### P0：`request_update` 广播时 strip `streamContent`（立竿见影）

`request-tracker.ts` 的 `broadcast()` 中，`request_update` 事件也应删除 `streamContent`。`streamContent` 已由独立的 `stream_content_update`（500ms 节流）推送，`request_update` 不需要重复携带。

```typescript
// broadcast() 方法中
if (event === "request_update" && Array.isArray(data)) {
  payload = data.map((req: ActiveRequest) => {
    const copy = { ...req };
    delete copy.clientRequest;
    delete copy.upstreamRequest;
    delete copy.streamContent;  // 已由 stream_content_update 独立推送
    delete copy.streamMetrics;  // 同上
    return copy;
  });
}
```

**预估收益**：SSE 带宽从 ~8.5MB/s 降至 ~4.7MB/s（减少 45%）。

### P0：降低 `StreamContentAccumulator` 的缓冲区上限

当前 `DEFAULT_MAX_RAW = 128KB`、`DEFAULT_MAX_TEXT = 64KB`。对于实时监控页面，前端只需要展示最近的内容，128KB 的原始 SSE 文本远超展示需要。

建议：
- `DEFAULT_MAX_RAW`：128KB → **32KB**（约 300 行 SSE 事件，足够展示）
- `DEFAULT_MAX_TEXT`：64KB → **16KB**
- blocks 单个 content 上限：64KB → **16KB**

**预估收益**：单个请求 snapshot 从 ~384KB 降至 ~96KB，SSE 带宽降至 ~1.9MB/s。

### P1：`TooltipProvider` 提升到父级共享

将每行的 `<TooltipProvider>` 移除，在 `ScrollArea` 外层包裹一个共享的 `<TooltipProvider>`。

```html
<!-- 替换前：每行一个 -->
<div v-for="req in streamingRequests" :key="req.id">
  <TooltipProvider><Tooltip>...</Tooltip></TooltipProvider>
  <TooltipProvider><Tooltip>...</Tooltip></TooltipProvider>
</div>

<!-- 替换后：共享一个 -->
<TooltipProvider :delay-duration="300">
  <div v-for="req in streamingRequests" :key="req.id">
    <Tooltip>...</Tooltip>
    <Tooltip>...</Tooltip>
  </div>
</TooltipProvider>
```

### P1：`now` 定时器优化

用 `requestAnimationFrame` 仅在页面可见时更新，或改为 CSS 动画展示 elapsed time。

### P2：`recentCompleted` 不保留 `streamContent`

后端 `complete()` 中清除已完成请求的 `streamContent`，避免 200 条已完成请求携带巨大文本快照。

### P2：前端添加 `visibilitychange` 监听

页面不可见时断开 SSE 连接，恢复时重连。避免后台标签页持续接收数据、解析 JSON、更新响应式对象。

---

## 验证方法

1. Chrome DevTools → Memory → Take Heap Snapshot，对比修复前后
2. Chrome DevTools → Network → EventStream，查看 SSE 消息大小和频率
3. Chrome DevTools → Performance → 录制 10s，查看 GC 频率和堆增长趋势

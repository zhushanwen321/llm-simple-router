# Monitor 页面性能优化 Plan

## Task 1：后端 broadcast 轻量化

### 描述

修改 `flushStreamContentPush()` 和 `broadcast()` 两个方法，将 `stream_content_update` 从推送完整 `StreamContentSnapshot` 改为轻量摘要。对所有包含 ActiveRequest 的 SSE 事件（`request_update`、`request_start`、`request_complete`）strip `streamContent`（`request_complete` 保留 `streamMetrics`）。`sendInitialSnapshot` 同步 strip。

**前置依赖**：无

### 验收标准

- [ ] `flushStreamContentPush()` 推送的 updates 中不含 `streamContent` 字段
- [ ] `flushStreamContentPush()` 推送的 updates 包含 `id`、`totalChars`、`streamMetrics`
- [ ] `broadcast()` 对 `request_update` 事件 strip `streamContent` 和 `streamMetrics`
- [ ] `broadcast()` 对 `request_start` 事件 strip `streamContent`（保留 `streamMetrics`）
- [ ] `broadcast()` 对 `request_complete` 事件 strip `streamContent`（保留 `streamMetrics`）
- [ ] `sendInitialSnapshot()` strip `streamContent` 和 `streamMetrics`
- [ ] 现有 `request-tracker.test.ts` 测试全部通过
- [ ] 新增测试：验证 `stream_content_update` 事件 payload 不含 `streamContent` 字段
- [ ] 新增测试：验证 `request_update` 事件 payload 不含 `streamContent`/`streamMetrics` 字段

### 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `router/src/core/monitor/request-tracker.ts` | 修改 | `flushStreamContentPush` 改推轻量摘要；`broadcast` 增加 strip；`sendInitialSnapshot` 增加 strip |
| `router/tests/request-tracker.test.ts` | 修改 | 新增 broadcast payload 结构断言 |

### 风险点

- `sendInitialSnapshot` 是新客户端连接时的初始推送，如果 strip 了 streamContent，新客户端在未选中请求前看不到流式内容——但这正是预期行为
- Task 2 的 `complete()` 清除 streamContent 应在 Task 1 的 broadcast strip 之后实施，但由于 Task 1 已对所有事件做了 strip，实施顺序不再有风险

---

## Task 2：后端缓冲区上限降低 + 完成清理

### 描述

降低 `StreamContentAccumulator` 的 `DEFAULT_MAX_RAW` 和 `DEFAULT_MAX_TEXT`。在 `request-tracker.ts` 的 `complete()` 中清除已完成请求的 `streamContent`。

### 验收标准

- [ ] `DEFAULT_MAX_RAW` 从 131072 改为 32768
- [ ] `DEFAULT_MAX_TEXT` 从 65536 改为 16384
- [ ] `complete()` 生成的 completed 对象中 `streamContent` 为 `undefined`
- [ ] `recentCompleted` 中的请求不含 `streamContent` 字段
- [ ] 现有 `stream-content-accumulator.test.ts` 测试通过（如有上限相关断言需更新）

### 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `router/src/core/monitor/stream-content-accumulator.ts` | 修改 | 降低两个常量 |
| `router/src/core/monitor/request-tracker.ts` | 修改 | `complete()` 中设置 `streamContent: undefined` |

### 风险点

- 降低上限后，详情对话框展示的流式内容可能被截断更早。但由于详情改为按需获取（直接从 accumulator 读），32KB rawChunks 仍有 ~300 行 SSE 事件，对展示足够
- 现有测试如果硬编码了 128KB/64KB 的数值，需要同步更新

---

## Task 3：前端按需获取 streamContent

### 描述

修改 `useMonitorData.ts`，将 `stream_content_update` handler 改为轻量更新（只更新 totalChars 和 streamMetrics），新增 `selectedStreamContent` ref 和 HTTP 轮询逻辑。修改 `Monitor.vue` 和 `UnifiedRequestDialog.vue` 读取 `selectedStreamContent` 而非 `selectedRequest.streamContent`。在 Monitor.vue 活跃请求列表行中新增 totalChars 和 streamMetrics 展示 UI。

**前置依赖**：Task 1 完成（后端已改为轻量推送）

### 验收标准

- [ ] `stream_content_update` handler 不再写入 `req.streamContent`
- [ ] `stream_content_update` handler 写入 `req.streamTotalChars`（新增字段，用于列表页展示）
- [ ] `selectRequest(id)` 启动 500ms 轮询 `GET /admin/api/monitor/request/:id`
- [ ] 轮询响应的 `streamContent` 写入 `selectedStreamContent` ref
- [ ] 轮询响应中 `streamContent` 为空/undefined 时，不清空 `selectedStreamContent`（保留上次值，防止闪烁）
- [ ] 请求完成（status 变为 completed/failed）时停止轮询
- [ ] 切换选择时停止旧轮询、启动新轮询
- [ ] `onUnmounted` 清理轮询定时器
- [ ] `UnifiedRequestDialog` 接收并使用 `selectedStreamContent` prop
- [ ] `ResponseViewer` 通过 prop 链路读取 `selectedStreamContent`
- [ ] Monitor.vue 活跃请求列表行展示 totalChars 数字
- [ ] Monitor.vue 活跃请求列表行展示 streamMetrics（tokensPerSecond）
- [ ] 请求完成后的日志详情（从 DB 加载）不受影响

### 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/composables/useMonitorData.ts` | 修改 | 轻量 handler + 轮询逻辑 + selectedStreamContent |
| `frontend/src/types/monitor.ts` | 修改 | ActiveRequest 新增可选 streamTotalChars 字段 |
| `frontend/src/views/Monitor.vue` | 修改 | 传递 selectedStreamContent 给 UnifiedRequestDialog |
| `frontend/src/components/request-detail/UnifiedRequestDialog.vue` | 修改 | 接收并使用 selectedStreamContent prop |

### 风险点

- `ActiveRequest` 类型中 `streamContent` 字段仍保留（不删除），但不再由 SSE 填充。需确保前端代码中其他引用 `streamContent` 的地方不依赖 SSE 推送
- `ResponseViewer.vue` 的 `props.streamContent` 需要改为从 `selectedStreamContent` 传入，需追踪完整的 prop 传递链路：Monitor.vue → UnifiedRequestDialog.vue → ResponseViewer.vue
- 轮询在请求完成后需立即停止，否则会 404（请求从 activeMap 移到 recentCompleted 后 `getRequestById` 仍能找到，但 streamContent 已被清除）
- **防闪烁**：轮询响应中 streamContent 为空时不更新 selectedStreamContent，仅在 request_complete SSE 事件触发 loadLogDetail 后清空（切换数据源为 DB）

---

## Task 4：前端 UI 优化（TooltipProvider + visibilitychange）

### 描述

将 Monitor.vue 中每行的 `<TooltipProvider>` 提升到父级共享。在 `useMonitorSSE.ts` 中添加 `visibilitychange` 监听，页面隐藏 > 30s 断开 SSE，恢复时重连。优化 `now` 定时器仅在页面可见时运行。

**前置依赖**：无（与 Task 3 并行可行，但建议在 Task 3 之后统一验证）

### 验收标准

- [ ] Monitor.vue 三个 ScrollArea 中每行不再各自包含 `<TooltipProvider>`
- [ ] 每列共享一个 `<TooltipProvider>`（提升到 ScrollArea 或 Card 级别）
- [ ] `useMonitorSSE.ts` 添加 `visibilitychange` 监听
- [ ] 页面隐藏 > 30s 后 SSE 连接断开（cleanup）
- [ ] 页面恢复可见时 SSE 自动重连（connect）
- [ ] `Monitor.vue` 的 `now` 定时器配合 visibilitychange：页面隐藏时暂停，恢复时重启
- [ ] `onUnmounted` 清理 visibilitychange 监听器

### 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/views/Monitor.vue` | 修改 | TooltipProvider 提升 + now 定时器优化 |
| `frontend/src/composables/useMonitorSSE.ts` | 修改 | 添加 visibilitychange 监听 |

### 风险点

- TooltipProvider 提升后，Tooltip 的定位（portal 渲染）不受影响——Radix Vue 的 Tooltip 默认 portal 到 body，与 Provider 位置无关
- visibilitychange 的 30s 延迟需要用 setTimeout 实现，在延迟期间如果用户切回，需取消断开操作

---

## Task 5：集成验证

### 描述

端到端验证所有变更的集成效果：运行后端构建 + 测试 + lint，验证编译和测试通过。

**前置依赖**：Task 1-4 全部完成

### 验收标准

- [ ] `npm run build` 编译通过（后端 + 前端）
- [ ] `npm test` 全部通过
- [ ] `npm run lint` 零警告
- [ ] `cd frontend && npx vue-tsc -b --noEmit` 类型检查通过

### 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| 无新增文件 | 验证 | 运行构建 + 测试 + lint |

### 风险点

- 前端类型检查 (`vue-tsc --noEmit`) 可能因新增字段暴露类型错误
- 如果 `streamTotalChars` 字段在 `ActiveRequest` 类型中定义但后端 SSE 事件名不同，需对齐

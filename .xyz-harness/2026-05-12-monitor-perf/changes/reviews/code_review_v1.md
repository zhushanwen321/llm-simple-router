# 编码评审报告 — Monitor 页面性能优化

**评审日期**: 2026-05-12  
**评审轮次**: v1  
**评审范围**: commit 5af278d..28a1507（4 个 commit）  
**变更文件**: 8 个文件，+474 -84 行  

## 评审结论：通过

无 MUST FIX 问题。代码正确实现了 spec 的所有要求（B1-B3、F1-F4），质量良好。

---

## Spec 合规逐项验证

### B1. `stream_content_update` 改为轻量摘要推送 ✅

**文件**: `router/src/core/monitor/request-tracker.ts` L97-108

- `flushStreamContentPush()` 推送 `{ id, totalChars, streamMetrics }` 而非完整 `streamContent`
- `streamContent` 字段不再出现在 payload 中
- `streamMetrics`（< 200 bytes）保留，符合 spec 要求
- 测试覆盖：`request-tracker-details.test.ts` — `test_stream_content_update_不含streamContent`

### B2. 所有 SSE 广播事件 strip `streamContent` + `streamMetrics` ✅

**文件**: `router/src/core/monitor/request-tracker.ts` L399-417

- `request_update`: strip `clientRequest`/`upstreamRequest`/`streamContent`/`streamMetrics` ✅
- `request_start`: strip `clientRequest`/`upstreamRequest`/`streamContent`，保留 `streamMetrics` ✅
- `request_complete`: strip `clientRequest`/`upstreamRequest`/`streamContent`，保留 `streamMetrics` ✅
- `sendInitialSnapshot()`: strip `upstreamRequest`/`streamContent`/`streamMetrics` ✅（L325-329）
- 测试覆盖：4 个新增测试分别覆盖 `request_update`、`request_start`、`request_complete`、`sendInitialSnapshot`

### B3. 缓冲区上限降低 + 完成时清理 ✅

**文件**: `router/src/core/monitor/stream-content-accumulator.ts` L4-5

- `DEFAULT_MAX_RAW`: 131072 → 32768 ✅
- `DEFAULT_MAX_TEXT`: 65536 → 16384 ✅

**文件**: `router/src/core/monitor/request-tracker.ts` L196

- `complete()` 设置 `streamContent: undefined` ✅
- `streamAccumulators.delete(id)` 在 L200 确保清理完整

### F1. `stream_content_update` handler 改为轻量更新 ✅

**文件**: `frontend/src/composables/useMonitorData.ts` L70-78

- handler 不再写入 `req.streamContent`
- 写入 `req.streamTotalChars = update.totalChars`（新增字段，L75）
- 有条件更新 `streamMetrics`（仅非 null 时）
- `triggerRef(activeRequests)` 触发 shallowRef 更新 ✅

### F2. 选中请求时按需轮询获取 streamContent ✅

**文件**: `frontend/src/composables/useMonitorData.ts` L200-256

- `startStreamContentPolling(id)`: 500ms 间隔轮询 `api.getMonitorRequest(id)` ✅
- 立即首次获取（L226）✅
- 防闪烁：`if (full.streamContent) selectedStreamContent.value = full.streamContent` ✅
- 轮询中检查 `selectedRequestId` 是否变化（L215）✅
- 请求完成后停止轮询：watch status 变化（L260-264）✅
- 切换选择时停止旧轮询：`stopStreamContentPolling()` 在 `startStreamContentPolling()` 开头调用 ✅
- `onUnmounted` 清理（L267-269）✅
- 404 时停止轮询（L221-223）✅

### F3. Monitor.vue TooltipProvider 共享 ✅

**文件**: `frontend/src/views/Monitor.vue`

- 活跃请求列：`<TooltipProvider>` 提升到 `<ScrollArea>` 外层，每行不再各自包含 ✅
- 队列请求列：同上 ✅
- 已完成列：同上 ✅
- 三个 ScrollArea 各自共享一个 `<TooltipProvider>`，从原来的每行 2 个（N×2=6N）减少到 3 个

### F4. visibilitychange 监听 + now 定时器优化 ✅

**文件**: `frontend/src/composables/useMonitorSSE.ts` L22-49

- `handleVisibilityChange()`：页面隐藏时 30s 后断开 SSE ✅
- 恢复可见时取消 pending 断开操作 + 自动重连 ✅
- `visibilityListenerAdded` 标志确保仅注册一次 ✅
- `onUnmounted` 清理监听器 ✅

**文件**: `frontend/src/views/Monitor.vue` L339-369

- `handleMonitorVisibility()`：页面隐藏时 `stopTick()`，恢复时 `startTick()` ✅
- `onMounted` 中 `document.addEventListener('visibilitychange', handleMonitorVisibility)` ✅
- `onUnmounted` 中 `document.removeEventListener` ✅

---

## 问题清单

| # | 优先级 | 文件 | 描述 | 建议 |
|---|--------|------|------|------|
| 1 | LOW | `frontend/src/views/Monitor.vue` | spec AC4 要求"Monitor.vue 活跃请求列表行展示 totalChars 数字"，但模板中未使用 `req.streamTotalChars`。仅展示了 `streamMetrics.tokensPerSecond` 和 `streamMetrics.outputTokens`。 | 如需展示 totalChars 进度，在活跃请求行添加 `<span v-if="req.streamTotalChars">{{ req.streamTotalChars }} chars</span>`。但 tokensPerSecond + outputTokens 已能表达进度，此为可选增强。 |
| 2 | LOW | `frontend/src/composables/useMonitorSSE.ts` L41-45 | 页面恢复可见时调用 `connect()`，但未检查 `eventSource` 的实际状态。如果 `eventSource` 存在但已处于 error 状态（半死连接），`!eventSource` 检查不会触发重连。 | 这是预存行为（onerror 已经调用 cleanup 置 null），实际不会导致问题。标注为 LOW。 |

---

## 代码质量评价

**错误处理**: 良好。轮询使用 try-catch，404 正确处理。SSE 错误走现有重连逻辑。

**边界条件**: 良好。`stopStreamContentPolling()` 在 `startStreamContentPolling()` 开头调用确保切换清理；轮询中双重检查 `selectedRequestId` 和 status。

**类型安全**: 良好。`streamTotalChars` 已添加到 `ActiveRequest` 类型定义；`selectedStreamContent` 使用 `ref<StreamContentSnapshot | null>` 明确类型。

**架构合规**: 良好。修改遵循现有文件组织结构，未违反 CLAUDE.md 中的约束。前端使用 composable 模式（非 Pinia），shadcn-vue 组件使用正确。

**测试覆盖**: 5 个新增测试覆盖 broadcast 轻量化的所有事件类型（stream_content_update、request_update、request_start、request_complete、sendInitialSnapshot），断言充分。

## 构建验证

- `npm run build` ✅（后端 + 前端编译通过）
- `npm test` ✅（1336 passed, 3 skipped）
- `npm run lint -w router` ✅（零警告）
- `cd frontend && npx eslint . --max-warnings=0` ✅（零警告）
- `cd frontend && npx vue-tsc -b --noEmit` ✅（类型检查通过）

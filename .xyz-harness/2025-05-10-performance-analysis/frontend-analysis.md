# 前端性能优化方案比较

> 分析日期：2025-05-10

---

## FE-H1: Dashboard loadProviderOutputTokens N+1 请求

### 当前实现

`useDashboard.ts:170-186` 对每个 provider 独立调用 `api.getStats(p2)` 获取 output tokens。

### 方案 A: 后端新增批量 API
- `POST /admin/api/stats/batch` 接收 `{ provider_ids, ...filters }`
- 前后端双端改动

### 方案 B: 复用已有 `getMetricsSummary`
- 后端 `getMetricsSummary` 已按 `provider_id` 分组返回 `total_output_tokens`
- 前端 1 次 `getMetricsSummary` 替代 N 次 `getStats`
- 仅前端改动

| 维度 | 方案 A | 方案 B |
|------|--------|--------|
| 性能收益 | N→1 | N→1 |
| 复杂度 | 中（双端） | 低（纯前端） |

### 风险评估
- 需验证 `getMetricsSummary` 与 `getStats` 在相同参数下返回一致的 output tokens
- 新注册无请求的 provider 在 `getMetricsSummary` rows 中不出现，需 fallback 到 0
- 参数构造需完全对齐（period/start_time/end_time）
- 风险等级：**低**

### 推荐：方案 B
理由：复用已有 API，零后端改动。

---

## FE-H2: Dashboard refresh 每次触发 5 个并行请求

### 方案 A: 后端聚合 API `GET /admin/api/dashboard`
- 5→1 HTTP 请求
- 复杂度：中高（前后端双端）

### 方案 B: 前端缓存 + debounce 增强
- 相同 filter 参数短时间复用上次结果
- 复杂度：低

### 方案 C: batch timeseries API
- 3 个 timeseries 合并为 1 个，5→3
- 复杂度：中

### 推荐：短期方案 B，长期方案 A
- 方案 B 成本最低，当前已有 300ms debounce
- 方案 A 是最优解但需后端改动，建议下一迭代

---

## FE-H3: SSE stream_content_update 频繁 re-render

### 当前实现

`useMonitorData.ts` 中 `activeRequests = ref<ActiveRequest[]>([])`，`stream_content_update` 修改内部属性触发深度响应追踪。3 个 computed 依赖 activeRequests，每次 stream_content_update 都重算。

### 方案 A: `ref` 改 `shallowRef` + `triggerRef`
- `stream_content_update` 循环结束后 `triggerRef(activeRequests)` 一次性触发
- 其他事件（request_start/complete/update）直接赋值，自然触发 shallowRef
- 改动：`useMonitorData.ts`，约 10 行

### 方案 B: 分离 streamContent 到独立 Map
- 精确到行级别更新
- 改动：多文件（useMonitorData + Monitor.vue + 子组件）

| 维度 | 方案 A | 方案 B |
|------|--------|--------|
| 性能收益 | 高 | 更高 |
| 复杂度 | 低 | 中高 |

### 风险评估
- `shallowRef` 下直接修改数组内部对象不触发响应
- `selectedRequest` computed 依赖 `activeRequests.value.find()`，shallowRef 后 triggerRef 会正确触发
- 风险等级：**低**

### 推荐：方案 A
理由：10 行改动，效果显著。方案 B 改动面大且收益边际递减。

---

## FE-H4: 路由切换重复鉴权请求

### 当前实现

`App.vue` 的 `watch(route.path, checkAuth)` + `router/index.ts` 的 `beforeEach` 都调用 `api.getStats()`。每次路由切换 2 次鉴权请求。

### 方案 A: 移除 App.vue watch，依赖 router beforeEach
- 删除 `watch(() => route.path, checkAuth)`
- 保留首次 `checkAuth()` 设置 `isAuthenticated`
- 改为 watch route.path 只更新 `isAuthenticated` 状态（不发请求）

```typescript
// App.vue
checkAuth()  // 保留首次
// 删除 watch(() => route.path, checkAuth)
watch(() => route.path, () => {
  isAuthenticated.value = !publicPages.includes(route.path)
})
```

### 风险评估
- `beforeEach` 作为路由守卫天然在组件挂载前执行，更可靠
- App.vue 通过 beforeEach 的路由跳转结果间接感知认证状态
- 需确保未认证时 App.vue 的 `isAuthenticated` 正确更新为 false
- 风险等级：**中**（需验证认证流程完整性）

### 推荐：方案 A（修正版）
理由：`beforeEach` 是标准鉴权位置。App.vue 只做首次认证 + 状态同步。

---

## FE-H5: Chart.js 注册了不需要的模块

### 方案 B（推荐）: 全项目搜索后移除
- 确认 `Title`/`Legend` 在全项目中的使用情况
- Dashboard `lineOptions` 设 `legend: { display: false }`
- 如果 `stackedAreaOptions`（`metrics-helpers.ts`）使用了 `legend: { position: 'bottom' }`，需保留 Legend
- 风险等级：**低**

---

## FE-M1: useSSEParsing computed 链

### 当前实现

15 个 computed 形成依赖链，全部依赖 `sseEvents`。但 Anthropic 的 6 个 computed 在 OpenAI 日志时通过 `if` 短路，OpenAI 的 6 个在 Anthropic 时短路。实际每次只计算一半。

### 方案 A: 按 apiType 条件分支
- 按当前 apiType 只创建对应的 computed
- 改动：`useSSEParsing.ts`，约 30 行

### 推荐：方案 A
- Vue computed 本身惰性求值，实际"全部重算"不成立
- 真正收益在于减少 computed 创建数量
- 风险等级：**低**

---

## FE-M2: LogTableRow 重复 useClipboard/useI18n 实例

### 方案 A: clipboard 提升到父组件
- `Logs.vue` 创建共享 `useClipboard`，改为 `copiedId: ref<string | null>` 模式
- 行内判断 `copiedId === log.id`
- **注意**：共享 `copied` boolean 会导致所有行同时显示"已复制"，必须改为 copiedId
- 改动：`Logs.vue` + `LogTableRow.vue`，约 20 行
- 风险等级：**中**（功能行为变化）

### 推荐：方案 A
理由：50 个 useClipboard 实例确实浪费。但需确保 copiedId 模式 UX 正确。

---

## FE-M3: Monitor now ref 每秒 re-render

### 方案 A: 降低更新频率到 3 秒
- `setInterval` 从 1000ms 改为 3000ms
- 改动：`Monitor.vue`，1 行
- 风险等级：**低**
- 监控页面的"已运行时长"不需要 1 秒精度

### 推荐：方案 A

---

## FE-M4: SSE 重连无指数退避

### 方案 A: 指数退避 + 30s 上限
- `delay = min(3000 * 2^attempt, 30000)`，连接成功后重置
- 改动：`useMonitorSSE.ts`，约 5 行
- Monitor 页面已有连接状态 Badge
- 风险等级：**低**

### 推荐：方案 A

---

## FE-M5: Dashboard watch 链重复请求

### 方案 A: 统一为单一 computed + 单一 watch
- 创建 `watchKey = computed(() => JSON.stringify({ periodTab, selectedProvider, ... }))`
- 只 watch `watchKey` 并 debounce
- 副作用（清空 custom dates、重置 modelFilter）保留为独立 watch 但不直接触发 refresh
- 改动：`useDashboard.ts`，约 30 行
- 风险等级：**中**（需确保所有 watch 副作用行为等价）

### 推荐：方案 A
理由：根因是多个独立 watch 执行顺序不可控。统一触发源最干净。

---

## FE-M6: Line chart 缺少 key

### 方案 A: 添加 `:key="periodTab + selectedProvider"`
- 改动：`Dashboard.vue` 模板，3 处
- 确保数据维度变化时 Chart.js 实例正确重建
- 风险等级：**低**

### 推荐：方案 A

---

## 实施优先级

| 优先级 | 编号 | 推荐 | 预估改动 | 风险 |
|--------|------|------|---------|------|
| P0 | FE-H4 | 移除 App.vue watch | ~5 行 | 中 |
| P0 | FE-M4 | SSE 指数退避 | ~5 行 | 低 |
| P0 | FE-M6 | chart 添加 key | 3 行 | 低 |
| P0 | FE-M3 | 降低 now 更新频率 | 1 行 | 低 |
| P1 | FE-H3 | shallowRef + triggerRef | ~10 行 | 低 |
| P1 | FE-H1 | 复用 getMetricsSummary | ~20 行 | 低 |
| P1 | FE-H5 | 移除多余 Chart.js 模块 | ~5 行 | 低 |
| P2 | FE-M5 | 统一 watch | ~30 行 | 中 |
| P2 | FE-M2 | clipboard 提升到父组件 | ~20 行 | 中 |
| P2 | FE-M1 | computed 条件分支 | ~30 行 | 低 |
| P3 | FE-H2 | 聚合 API | 中 | 中 |

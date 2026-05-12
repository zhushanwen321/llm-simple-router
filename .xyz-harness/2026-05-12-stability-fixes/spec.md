# 稳定性修复 — Spec

> 日期：2026-05-12 | 分支：feat-performance-impr | 范围：第一阶段（稳定性修复）

## 目标

修复四维分析报告（docs/impr/）中识别的**高优先级稳定性问题**，消除前端白屏风险、后端事件循环阻塞、数据库查询全表扫描、以及流式代理内存浪费。本批次共 8 项修复，所有改动控制在最小影响面内，不涉及架构重构。

---

## 当前批次（方案 A）：8 项修复

### F1. 注册全局 Vue 错误处理器

**问题**：项目中没有 `app.config.errorHandler`，任何组件渲染异常直接白屏。也没有 404 兜底路由。

**修复**：
- 在 `frontend/src/main.ts` 中注册 `app.config.errorHandler`，捕获未处理的 Vue 错误并 toast 提示用户
- 在 `frontend/src/router/index.ts` 中添加 `{ path: '/:pathMatch(.*)*', redirect: '/' }` 兜底路由
- 不需要 ErrorBoundary 组件（过度设计，全局 errorHandler 已够用）

**验收标准**：
- [ ] `main.ts` 中注册了 `app.config.errorHandler`，错误时 console.error + toast.error
- [ ] 路由表末尾有 catch-all 路由，未知路径重定向到 `/`
- [ ] 编译通过 + 前端类型检查通过

**影响文件**：
| 文件 | 操作 |
|------|------|
| `frontend/src/main.ts` | 修改：注册 errorHandler |
| `frontend/src/router/index.ts` | 修改：添加 catch-all 路由 |

---

### F2. i18n 翻译不阻塞 app mount

**问题**：`loadLocaleMessages(initLocale).then(() => app.mount('#app'))` 导致首屏白屏直到全部 16 个 JSON 文件加载完成。慢网络下延迟 500ms-2s。

**修复**：
- 先 `app.mount('#app')`，在 App.vue 中展示 loading skeleton
- 异步加载 locale 完成后自动切换到正常内容（vue-i18n 的 `mergeLocaleMessage` 会自动更新）
- 初始时用一个简单的 loading 指示器（不需要骨架屏组件，简单的居中 spinner 即可）

**当前代码**（`main.ts`）：
```typescript
loadLocaleMessages(initLocale).then(() => {
  app.mount('#app')
})
```

**目标代码思路**：
```typescript
app.mount('#app')  // 立即挂载，App.vue 展示 loading
loadLocaleMessages(initLocale)  // 异步加载，完成后 vue-i18n 自动响应
```

App.vue 中需要在 locale 加载完成前展示 loading 状态。可以通过一个模块级 `ref` 跟踪 locale 加载状态。

**验收标准**：
- [ ] `app.mount('#app')` 不被 `loadLocaleMessages` 阻塞
- [ ] locale 加载完成前显示 loading 指示器
- [ ] locale 加载完成后自动切换到正常内容
- [ ] 编译通过

**影响文件**：
| 文件 | 操作 |
|------|------|
| `frontend/src/main.ts` | 修改：先 mount 再 load locale |
| `frontend/src/i18n/index.ts` | 修改：导出 locale 加载状态 ref |
| `frontend/src/App.vue` | 修改：添加 locale loading 状态 |

---

### F3. useDashboard refreshTimer 泄漏修复

**问题**：`refreshTimer`（300ms debounce setTimeout）在 `onUnmounted` 中未清理，组件卸载后 timer 仍会触发 API 请求。

**修复**：
- 在 `onUnmounted` 回调中添加 `if (refreshTimer) clearTimeout(refreshTimer)`

**当前代码**（`useDashboard.ts`）：
```typescript
onUnmounted(() => {
  if (stopWatchTheme) stopWatchTheme()
})
```

**目标**：
```typescript
onUnmounted(() => {
  if (stopWatchTheme) stopWatchTheme()
  if (refreshTimer) clearTimeout(refreshTimer)
})
```

**验收标准**：
- [ ] `onUnmounted` 中清理了 `refreshTimer`
- [ ] Dashboard 页面功能不受影响

**影响文件**：
| 文件 | 操作 |
|------|------|
| `frontend/src/composables/useDashboard.ts` | 修改：onUnmounted 添加 clearTimeout |

---

### F4. SQLite 日志写入改为透明内部缓冲

**问题**：`insertRequestLog` 和 `insertMetrics` 是同步 better-sqlite3 调用，在每条请求的热路径上阻塞事件循环。高 QPS 下 DB 写入占用事件循环时间的比例显著。

**修复**（透明内部缓冲方案）：
- 创建 `LogWriteBuffer` 类，在 `logs.ts` 和 `metrics.ts` 模块内部透明使用
- **所有现有调用点零修改** — `insertRequestLog()` 和 `insertMetrics()` 的签名和行为不变
- 缓冲逻辑：
  - `insertRequestLog()` 内部先执行 LogFileWriter.write()（保持同步，它本身是异步 WriteStream），然后将 DB INSERT 部分推入缓冲
  - `insertMetrics()` 内部预生成 UUID（保持返回值语义），然后将 DB INSERT 部分推入缓冲
  - 缓冲每 100ms 或达到 50 条时自动 flush
  - flush 使用 `db.transaction()` 批量写入
- 提供 `initLogBuffer(db)` / `stopLogBuffer()` 供 `index.ts` 调用
- **测试中不调用 `initLogBuffer()`**，保持原有同步行为，测试零修改

**设计决策：透明 vs 上层封装**：
- 选择透明内部缓冲而非上层封装，原因：
  1. 调用点 10+ 个（proxy-logging.ts 5 个、failover-loop.ts 2 个、create-proxy-handler.ts 1 个、error-logging.ts 2 个、index.ts errorHandler 1 个），上层封装需要修改所有调用点
  2. 透明方案保留 API 契约（insertMetrics 返回值语义不变）
  3. LogFileWriter.write() 和 DB INSERT 需要在 insertRequestLog 内部分离处理，上层封装无法实现
  4. 测试隔离简单——不初始化缓冲即回退到同步模式

**关键约束**：
- `stopLogBuffer()` 是同步方法（内部调用同步 flush），与 LogFileWriter.stop()（异步）区分
- close() 中先 `stopLogBuffer()`（同步 flush DB），再 `await logFileWriter?.stop()`（异步 flush 文件）
- LogWriteBuffer 注册到 ServiceContainer（`SERVICE_KEYS.logWriteBuffer`）

**已有基础设施**：
- `router/src/storage/log-file-writer.ts` — LogFileWriter 已有类似的缓冲模式（write + stop flush），可参考
- `router/src/db/logs.ts` — `insertRequestLog` 函数（在此函数内部添加缓冲逻辑）
- `router/src/db/metrics.ts` — `insertMetrics` 函数（在此函数内部添加缓冲逻辑）
- `router/src/index.ts` — `close()` 函数中已有 `logFileWriter?.stop()` 模式

**验收标准**：
- [ ] `LogWriteBuffer` 类实现，含 push/flush/stop 方法
- [ ] `insertRequestLog` 内部透明使用缓冲（LogFileWriter 保持同步调用，DB INSERT 缓冲）
- [ ] `insertMetrics` 内部透明使用缓冲（预生成 UUID，DB INSERT 缓冲）
- [ ] 所有现有调用点（10+ 个）零修改
- [ ] close() 中调用 stopLogBuffer() 确保数据持久化
- [ ] 现有测试全部通过（测试不初始化缓冲，走同步路径）
- [ ] 新增 LogWriteBuffer 单元测试

**影响文件**：
| 文件 | 操作 |
|------|------|
| `router/src/db/log-write-buffer.ts` | 新建：LogWriteBuffer 类 |
| `router/src/db/logs.ts` | 修改：insertRequestLog 内部添加缓冲逻辑 |
| `router/src/db/metrics.ts` | 修改：insertMetrics 内部添加缓冲逻辑 |
| `router/src/core/container.ts` | 修改：添加 SERVICE_KEYS.logWriteBuffer |
| `router/src/index.ts` | 修改：buildApp 中 initLogBuffer，close 中 stopLogBuffer |
| `tests/log-write-buffer.test.ts` | 新建：缓冲逻辑单元测试 |

---

### F5. request_metrics 添加复合索引

**问题**：`request_metrics` 表只有 router_key 相关索引（044 号迁移），缺少 `(is_complete, created_at, provider_id, backend_model)` 复合索引。Dashboard 的 `getMetricsSummary` 和 `getMetricsTimeseries` 查询全表扫描。

**修复**：
- 新增 migration 045，添加复合索引：
  ```sql
  -- request_metrics 核心聚合索引（Dashboard getMetricsSummary + getMetricsTimeseries）
  CREATE INDEX IF NOT EXISTS idx_metrics_agg
    ON request_metrics(is_complete, created_at DESC, provider_id, backend_model);

  -- request_logs 子请求查询（original_request_id 索引已存在于 018，此处添加含时间排序的复合索引）
  -- 注：018 已有 idx_request_logs_original_request_id(original_request_id)，本索引额外覆盖时间排序
  CREATE INDEX IF NOT EXISTS idx_logs_original_time
    ON request_logs(original_request_id, created_at DESC);
  ```

**注**：不添加 `status_code` 单列索引——区分度太低（只有几种状态码），SQLite 优化器不会使用。也不添加与 018 重复的 `original_request_id` 单列索引。

**验收标准**：
- [ ] 新增 migration 045 SQL 文件
- [ ] 索引包含 is_complete + created_at + provider_id + backend_model
- [ ] 不与 018 migration 的索引重复
- [ ] 现有测试通过（migration 自动执行）

**影响文件**：
| 文件 | 操作 |
|------|------|
| `router/src/db/migrations/045_add_metrics_composite_indexes.sql` | 新建 |

---

### F6. StreamProxy 移除冗余 captureChunks

**问题**：`StreamProxy` 维护冗余的 `captureChunks` 数组（与 `bufferChunks` 存储相同的 Buffer 引用），增加状态管理复杂度。

**修复**：
- 移除 `captureChunks` 数组
- 所有对 `captureChunks` 的引用改为使用 `bufferChunks`

**完整时序分析**（覆盖所有状态路径）：

路径 1：checkEarlyError 不存在
- `onData`: push 到 bufferChunks（仅一份）
- 收到上游 response 后立即调用 `startStreaming()`（因为 `!checkEarlyError`）
- `startStreaming()`: Buffer.concat(bufferChunks) → flush 到 pipe → bufferChunks.length = 0
- 后续 onData: 直接写 pipeEntry（STREAMING 阶段）
- onEnd: state 已是 STREAMING → 走 STREAMING 分支 → transition COMPLETED → **不使用任何 buffer 数组**

路径 2：checkEarlyError 存在，BUFFERING 阶段内触发 startStreaming
- `onData`: push 到 bufferChunks，检查 BUFFER_SIZE_LIMIT 或 \n\n
- 触发条件满足 → `startStreaming()`: Buffer.concat(bufferChunks) → early error check → flush → bufferChunks.length = 0
- 后续 onData: 直接写 pipeEntry
- onEnd: state 已是 STREAMING → 走 STREAMING 分支 → **不使用 buffer 数组**

路径 3：checkEarlyError 存在，整个响应在 BUFFERING 阶段完成（< 4KB 且无 \n\n）
- `onData`: push 到 bufferChunks（仅一份），始终未触发 startStreaming
- onEnd: state 仍是 BUFFERING → 走 BUFFERING 分支 → Buffer.concat(bufferChunks) → final early error check → **bufferChunks 此时尚未被清空**（startStreaming 未触发）

**结论**：三个路径都不需要 captureChunks。路径 3 是唯一使用 captureChunks 的场景，而 bufferChunks 在此时完整保留可用。

**验收标准**：
- [ ] `captureChunks` 数组被移除
- [ ] 所有对 captureChunks 的引用改为 bufferChunks
- [ ] 三个路径的 early error 检测功能不受影响
- [ ] 流式代理功能不受影响（现有测试通过）

**影响文件**：
| 文件 | 操作 |
|------|------|
| `router/src/proxy/transport/stream.ts` | 修改：移除 captureChunks |

---

### F7. MetricsExtractor join 截断优化

**问题**：`getMetrics()` 中 `this.thinkingChunks.join("")` 创建最多 500KB 中间字符串，然后 `countTokens()` 只用前 4000 字符做采样。textChunks 和 toolUseChunks 同理。

**修复**：
- 在 `countTokens` 层面优化：添加 `countTokensFromChunks(chunks: string[], limit?: number)` 函数
- 只 join 必要的前 N 个字符（基于 limit 参数，默认 4000），避免创建完整大字符串
- `getMetrics()` 调用 `countTokensFromChunks` 替代 `countTokens(chunks.join(""))`

**已有基础设施**：
- `router/src/utils/token-counter.ts` — `countTokens(text: string)` 函数，已有 >4000 字符采样策略
- 采样外推逻辑：`SAMPLE_SIZE = 4000`，取前 4000 字符计算 token 后按字符比率外推

**验收标准**：
- [ ] 新增 `countTokensFromChunks` 函数，只 join 前 SAMPLE_SIZE 字符
- [ ] `MetricsExtractor.getMetrics()` 使用新函数
- [ ] token 计数结果在数学上等价（前 4000 字符的采样结果不变）
- [ ] 现有测试通过

**影响文件**：
| 文件 | 操作 |
|------|------|
| `router/src/utils/token-counter.ts` | 修改：新增 countTokensFromChunks |
| `router/src/metrics/metrics-extractor.ts` | 修改：getMetrics 使用新函数 |
| `tests/token-counter.test.ts` | 修改：新增 countTokensFromChunks 测试 |

---

### F8. Google Fonts @import 改为 link preconnect

**问题**：`frontend/src/style.css` 使用 `@import url(...)` 加载 Geist 字体，形成请求链阻塞渲染。

**修复**：
- 从 `style.css` 中移除 `@import url('https://fonts.googleapis.com/css2?family=Geist:...')`
- 在 `frontend/index.html` 的 `<head>` 中添加 preconnect + link 标签

**验收标准**：
- [ ] style.css 不再有 @import 字体
- [ ] index.html 有 `<link rel="preconnect">` + `<link rel="stylesheet">` 加载 Geist
- [ ] 字体渲染效果不变

**影响文件**：
| 文件 | 操作 |
|------|------|
| `frontend/src/style.css` | 修改：移除 @import |
| `frontend/index.html` | 修改：添加 preconnect + link |

---

## 已有基础设施

### 可复用的现有 API

| 位置 | 方法/组件 | 用途 |
|------|----------|------|
| `router/src/storage/log-file-writer.ts` | `LogFileWriter` | 已有 write + stop flush 缓冲模式，可参考实现 LogWriteBuffer |
| `router/src/utils/token-counter.ts` | `countTokens` | 已有采样外推策略，在此基础上添加 chunks 版本 |
| `frontend/src/composables/useTheme.ts` | `initThemeEarly()` | 主题早期初始化模式 |
| `frontend/src/i18n/index.ts` | `loadLocaleMessages` | locale 加载函数 |

### 接口/类型定义位置

| 位置 | 接口名 | 用途 |
|------|--------|------|
| `router/src/db/logs.ts` | `LogWriteContext`, `RequestLogInsert` | 日志写入参数类型 |
| `router/src/db/metrics.ts` | `MetricsInsert` | 指标写入参数类型（27 字段） |
| `router/src/metrics/metrics-extractor.ts` | `MetricsResult` | 指标提取结果类型 |

### 已知技术债务

| 文件 | 问题 | 原因 |
|------|------|------|
| `router/src/proxy/handler/failover-loop.ts` | Pipeline/Hook 重构半完成 | 第二批次处理 |
| `router/src/proxy/transport/stream.ts` | 缺少背压处理 | LLM 场景下不需要，低优先级 |
| `frontend/src/App.vue` | 与 router.beforeEach 双重认证检查 | 第二批次处理 |

---

## 不在本批次范围（Backlog）

以下问题记录自四维分析报告，将在后续批次处理。

### 前端架构（中/低优先级）

| # | 问题 | 优先级 |
|---|------|--------|
| FA-M1 | Composable 依赖无法注入 mock（useProviderForm 等） | P1 |
| FA-M2 | useMonitorData 中 shallowRef + triggerRef 模式脆弱 | P1 |
| FA-M3 | App.vue 和 router.beforeEach 双重认证检查 | P1 |
| FA-M4 | Chart.js 主题切换触发不必要的 API 请求 | P1 |
| FA-M5 | CSS 间距令牌未映射到 Tailwind config | P1 |
| FA-M6 | Schedules.vue 544 行需拆分 | P1 |
| FA-M7 | catch 块中 apiCode 断言不一致，需 getApiCode() 工具函数 | P1 |
| FA-L1 | Sidebar 升级逻辑应抽为独立组件 | P2 |
| FA-L2 | log-viewer/ 与 logs/ 目录职责模糊 | P2 |
| FA-L3 | CascadingSelect 在 ui/ 但非 shadcn 基础组件 | P3 |
| FA-L4 | env.d.ts 中 *.vue 模块声明过于宽泛 | P3 |
| FA-L5 | lib/utils.ts 几乎空置 | P3 |
| FA-L6 | 缺少翻译文件完整性检查 | P3 |
| FA-L7 | Dashboard filter 切换缺少请求取消 | P2 |

### 前端性能（中/低优先级）

| # | 问题 | 优先级 |
|---|------|--------|
| FP-M1 | vite build.manualChunks 未配置 | P1 |
| FP-M2 | @intlify/unplugin-vue-i18n 已安装未启用 | P1 |
| FP-M3 | providers/routerKeys 等元数据需全局缓存 | P1 |
| FP-M4 | API 请求缺少 AbortController 竞态处理 | P1 |
| FP-M5 | ModelMappingCard / ResponseViewer deep watch 优化 | P1 |
| FP-M6 | Monitor 每行 TooltipProvider 改为共享 | P2 |
| FP-L1 | 前端性能监控（Web Vitals + Lighthouse CI） | P2 |
| FP-L2 | 添加 bundle 分析工具 | P2 |
| FP-L3 | font-mono 实际加载 JetBrains Mono | P3 |
| FP-L4 | SSE 在 background tab 时断开 | P3 |
| FP-L5 | 自托管 Geist 字体 | P3 |
| FP-L6 | useClipboard setTimeout 清理 | P3 |

### 后端架构（中/低优先级）

| # | 问题 | 优先级 |
|---|------|--------|
| BA-M1 | 格式转换层代码重复严重（4161 行） | P1 |
| BA-M2 | failover-loop.ts 过长（558 行），需拆分阶段函数 | P1 |
| BA-M3 | index.ts 过长（509 行），提取初始化模块 | P1 |
| BA-M4 | ServiceContainer 缺 dispose 生命周期管理 | P1 |
| BA-M5 | 废弃 src/routing/ 目录 | P2 |
| BA-M6 | 44 个 migration 文件需 squash | P2 |
| BA-M7 | metrics/ 和 core/monitor/ 职责重叠 | P2 |
| BA-L1 | Admin API 验证未全面 TypeBox | P3 |
| BA-L2 | Hook 的 metadata 用 Map<string, unknown> | P3 |
| BA-L3 | request-tracker.ts SSE 与追踪耦合 | P3 |
| BA-L4 | createProxyHandler 服务定位器模式 | P3 |
| BA-L5 | 应用层迁移缺版本追踪 | P3 |

### 后端性能（中/低优先级）

| # | 问题 | 优先级 |
|---|------|--------|
| BP-M1 | callNonStream 缺少请求超时 | P1 |
| BP-M2 | transport 层重复 JSON.stringify(body) | P1 |
| BP-M3 | SSEMetricsTransform 与 BaseSSETransform 双重 JSON.parse | P1 |
| BP-M4 | request_logs 缺 original_request_id 和 status_code 索引 | P2 |
| BP-M5 | recentCompleted 存储完整 clientRequest JSON | P2 |
| BP-M6 | sseScanBuffer 每次 slice 创建新字符串 | P3 |
| BP-L1 | Worker Thread 隔离 SQLite | 长期 |
| BP-L2 | HTTP Agent 按 provider host 独立创建 | 长期 |
| BP-L3 | tool-mapper 转换结果缓存 | 长期 |
| BP-L4 | request_metrics 查询百分位实现 | 长期 |
| BP-L5 | countTokens 改用 Streaming BPE | 长期 |
| BP-L6 | StreamProxy Buffer.concat 优化 | 长期 |
| BP-L7 | pipeline hook 并行化 | 长期 |
| BP-L8 | PRAGMA cache_size 增大 | 长期 |

### 后端架构 P0（Pipeline 迁移 — 第二批次最高优先级）

| # | 问题 | 优先级 |
|---|------|--------|
| BA-H1 | Pipeline emit 点缺失 — 9 个 hook 中 7 个从未执行 | P0 |
| BA-H2 | 内联逻辑与 hook 重复实现（failover-loop.ts） | P0 |
| BA-H3 | hookRegistry 和 proxyPipeline 双注册表 | P0 |
| BA-H4 | admin/providers.ts → proxy/transport/http 反向依赖 | P0 |

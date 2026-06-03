# 分组 10: Monitor

## 审查结论

**有差异** — 5 个文件中有 3 个存在功能差异（Monitor.vue、MonitorHeader.vue、RuntimePanel.vue），2 个差异仅涉及样式/工具提取（ConcurrencyPanel.vue、ProviderStatsTable.vue）。另有 1 个新增工具文件。

---

## 差异详情

### 文件: Monitor.vue

- 差异类型: 功能变更 + 新增功能
- 详细说明:

  **1. SSE 生命周期管理方式变更（功能变更）**
  - `feat`: `useMonitorData()` 内部封装了 `useMonitorSSE()`，直接返回 `connect` / `disconnect` / `loadInitialData` 三个函数。页面层调用 `connect()` 无需传入事件处理器。
  - `main`: `useMonitorData()` 返回 `handleSSEMessage` / `handleSSEOpen` / `handleSSEClose` 等独立 handler，页面层需显式调用 `useMonitorSSE(url, handlers, callbacks)`。
  - 影响评估: **中** — 功能等价，但 SSE 生命周期从页面层下沉到 composable 层。如后续 composable 封装的 connect/disconnect 内部有额外逻辑（如自动重连、事件过滤），可能与 main 行为不同。当前版本两者行为等价（都是调用 useMonitorSSE 并转发 connect）。

  **2. 请求列表从三列卡片改为统一 Tab 表格（功能变更）**
  - `feat`: 使用单一 Table 组件 + Tab 切换（active / queued / recent 三个 Tab），行内展示 model/provider/type/elapsed/speed/output，并支持行展开显示请求详情（ID、input/output/cache tokens）。
  - `main`: 使用三个独立 Card 组件（活跃请求、队列请求、已完成），每个 Card 内用简单的 flex 列表展示请求，无速度/输出 token 列，无行展开。
  - 影响评估: **高** — 用户交互模型完全变化。feat 新增了行展开详情、TPS/Output 实时列、复制 ID 按钮、Kill 按钮条件显示等。需确认所有数据字段在两个版本中均从同一 source 填充。

  **3. MonitorHeader 传参增加（功能变更）**
  - `feat`: 向 MonitorHeader 传入 5 个 props：`stats`、`activeCount`、`streamCount`、`queuedCount`、`concurrency`。
  - `main`: 仅传入 3 个 props：`stats`、`activeCount`、`streamCount`。
  - 影响评估: **高** — MonitorHeader 组件功能完全不同（见 MonitorHeader.vue 分析），`queuedCount` 和 `concurrency` 的传递使 MonitorHeader 承担了原来的 ConcurrencyPanel 职责。

  **4. 新增 Secondary Strip 统计区（新增功能）**
  - `feat`: 在请求表格下方新增一个横向统计条，展示 Completed Count、Error Rate、P50 Latency、Retry Rate、Uptime 五个指标。使用 `computed` 计算 `errorRate` / `retryRate` / `p50Latency` / `p99Latency` / `qps` / `uptimeText`。
  - `main`: 错误率/P50/重试率在 MonitorHeader 中展示为 4 个独立卡片。无 uptime、qps、p99 展示。
  - 影响评估: **中** — 新增 QPS 和 uptime 指标。原有 error rate / p50 / retry rate 的计算逻辑从 MonitorHeader 迁移到 Monitor.vue，计算公式一致（`errorCount/totalRequests*100`、`retryCount/totalRequests*100`、`p50LatencyMs.toFixed(0)`），功能等价。

  **5. Provider 统计改为可折叠（功能变更）**
  - `feat`: `ProviderStatsTable` 包裹在 `<Collapsible>` 中，默认展开，用户可收起。
  - `main`: `ProviderStatsTable` 始终在 Card 中可见，不可折叠。
  - 影响评估: **低** — 仅交互方式变化，数据/逻辑完全一致。

  **6. 底部三列面板内容变更（功能变更）**
  - `feat`: 3 列为 StatusCodePanel / RuntimePanel / 全局并发汇总（Global Concurrency）。全局并发显示 active/total/pct 进度条 + P99 + QPS。
  - `main`: 3 列为 ConcurrencyPanel（逐 Provider 并发条）/ StatusCodePanel / RuntimePanel。
  - 影响评估: **高** — 逐 Provider 的并发面板（ConcurrencyPanel）被替换为全局并发汇总。逐 Provider 的并发信息现集成在 MonitorHeader 中（内联进度条）。`ConcurrencyPanel` 组件在 feat 中虽然文件存在，但已不在 Monitor.vue 中使用。

  **7. Kill 按钮条件限制（功能变更）**
  - `feat`: `isKillable(req)` 返回 `req.status === "pending"`，仅 pending 状态的请求显示 Kill 按钮。
  - `main`: Kill 按钮对所有活跃请求和队列请求均无条件显示。
  - 影响评估: **中** — 行为收紧。如果后端确实只允许 kill pending 状态的请求，feat 更正确；如果后端也支持 kill 非 pending 请求，则 feat 会导致功能缺失。需确认后端 `/admin/api/monitor/kill/:id` 的约束。

  **8. 行展开详情（新增功能）**
  - `feat`: 点击行末 ChevronDown 按钮可展开请求详情行，显示 Request ID、Input Tokens、Output Tokens、Cache Tokens。`expandedRowId` 控制单行展开状态。
  - `main`: 无此功能。
  - 影响评估: **低** — 纯增量功能，不改变原有数据流。

  **9. 新增 computed 和辅助函数**
  - `feat` 新增: `requestTabs`、`TAB_DATA`、`TAB_EMPTY`、`currentRequests`、`emptyMessage`、`rowElapsed`、`rowTps`、`rowOutputTokens`、`statusDotClass`、`isKillable`、`errorRateClass`、`globalConcurrency`、`globalConcurrencyBarClass`、`uptimeText`、`uptimeSinceText`、`formatUptime`。
  - `main` 有: `elapsed`（等价于 rowElapsed）、`duration`（feat 无对应，因已完成请求使用 `completedAt`）。
  - 影响评估: **低** — 新增函数服务于新 UI，不改变旧逻辑。

- 影响评估: **高**

---

### 文件: ConcurrencyPanel.vue

- 差异类型: 代码重构
- 详细说明:

  **1. 并发工具函数提取到 `@/utils/concurrency`**
  - `feat`: 从 `@/utils/concurrency` 导入 `effectiveLimit`、`concurrencyBarClass as barColor`。
  - `main`: 在组件内本地定义 `effectiveLimit()` 和 `barColor()`，逻辑完全相同。
  - 影响评估: **低** — 纯代码组织变化，功能等价。但需确认 `@/utils/concurrency` 中 `concurrencyBarClass` 返回的 CSS 类名与 main 的 `barColor` 返回的类名在项目中语义一致。main 返回硬编码颜色（`bg-red-500` 等），feat 使用语义 token（推测为 `bg-danger` / `bg-warning` / `bg-success` / `bg-primary`）。

  **2. 进度条背景色类名**
  - `feat`: `bg-foreground/10`
  - `main`: `bg-muted`
  - 影响评估: **低** — 视觉差异，不影响功能。

  **3. `PERCENT_MAX` 常量提取**
  - `feat`: 模块级常量 `const PERCENT_MAX = 100;`
  - `main`: 内联硬编码 `100`
  - 影响评估: **低** — 无功能差异。

- 影响评估: **低**

---

### 文件: MonitorHeader.vue

- 差异类型: 功能变更
- 详细说明:

  **feat 版本**：
  - 布局：左栏（活跃请求数 + 流式/非流式分布 + 队列 Badge）+ 右栏（逐 Provider 并发进度条，与 ConcurrencyPanel 逻辑相同但以内联形式展示）
  - 接收 5 个 props：`stats`, `activeCount`, `streamCount`, `queuedCount`, `concurrency`
  - 使用 `@/utils/concurrency` 的 `effectiveLimit`、`concurrencyBarClass`、`concurrencyRatioClass`
  - 不展示 error rate / p50 latency / retry rate

  **main 版本**：
  - 布局：4 列 Card 网格（Active Requests、Error Rate、P50 Latency、Retry Rate）
  - 接收 3 个 props：`stats`, `activeCount`, `streamCount`
  - 内部计算 `errorRate` / `retryRate` / `p50Latency`（使用 `computed`，公式与 feat Monitor.vue 中的计算逻辑完全相同）
  - 不展示逐 Provider 并发

  **影响**：
  - Error Rate / P50 / Retry Rate 从 MonitorHeader 迁移到了 Monitor.vue 的 Secondary Strip 中，计算逻辑完全一致
  - 逐 Provider 并发从 ConcurrencyPanel 迁移到了 MonitorHeader 中（内联进度条），不再在底部三列中显示
  - `queuedCount` prop 是新增的，feat 在 MonitorHeader 中显示队列计数 badge

- 影响评估: **高** — 两个版本承担完全不同的展示职责。

---

### 文件: ProviderStatsTable.vue

- 差异类型: 代码重构（仅样式差异）
- 详细说明:

  **feat 版本**：
  - 使用语义 CSS 类名：`text-success` / `text-warning` / `text-danger`
  - TableHead 增加 `text-[10px] font-semibold uppercase tracking-wider` 等排版类
  - TableCell 增加 `font-mono text-xs py-1`
  - TableRow 增加 `border-b-0`
  - 提取 `PERCENT_100 = 100` 模块级常量

  **main 版本**：
  - 使用硬编码 Tailwind 颜色：`text-green-600 dark:text-green-400` / `text-yellow-600 dark:text-yellow-400` / `text-red-500 dark:text-red-400`
  - TableHead 无额外排版类
  - TableCell 无 `font-mono`
  - 内联 `100`

  **核心逻辑**：
  - `providerEntries` computed 完全一致：`Object.entries(props.stats.byProvider).filter().map()` 相同，`successRate` 和 `retryRate` 计算公式相同
  - Props 接口一致：`stats: StatsSnapshot | null`
  - 空状态处理一致：`!stats` → "noData" / `providerEntries.length === 0` → "noProviders"

- 影响评估: **低** — 功能完全等价，仅样式重构。

---

### 文件: RuntimePanel.vue

- 差异类型: 功能变更 + 功能缺失
- 详细说明:

  **feat 版本（堆叠列表布局）**：
  - 显示：Memory RSS、Event Loop Delay、Active Handles、Heap 使用率进度条
  - 不显示：Uptime、Active Requests
  - Event Loop Delay 精度：`runtime.eventLoopDelayMs.toFixed(1)` (1 位小数)

  **main 版本（网格布局）**：
  - 显示：Uptime、Memory RSS、Heap 使用率进度条、Active Handles、Active Requests、Event Loop Delay
  - 包含 `formatUptime()` 辅助函数
  - Event Loop Delay 精度：`runtime.eventLoopDelayMs.toFixed(2)` (2 位小数)

  **功能差异**：

  | 指标 | feat | main |
  |------|------|------|
  | Uptime | 已移除（迁移到 Monitor.vue Secondary Strip） | 在组件内展示 |
  | Active Requests | 已移除（无对应展示） | 在组件内展示 |
  | Event Loop Delay 精度 | 1 位小数 | 2 位小数 |
  | Memory RSS | 存在 | 存在 |
  | Active Handles | 存在 | 存在 |
  | Heap 使用率 Bar | 存在 | 存在 |

  **Props 接口**：完全一致（`runtime: RuntimeMetrics | null`）

  **`heapPercent` 计算**：逻辑完全一致，feat 提取了 `MAX_HEAP_PERCENT` 常量（100）。

- 影响评估: **中** — `activeRequests` 在 feat 的 RuntimePanel 中完全缺失。此数据在 `RuntimeMetrics` 类型中可能存在（来自后端 SSE 的 `runtime_update` 事件），但 feat 在面板中不再展示。如果用户依赖此面板查看活跃请求数的 runtime 视角数据（与上方列表中的 active count 是不同数据源），则造成功能缺失。Event Loop Delay 精度从 2 位降至 1 位，属于次要差异。

---

## 新增文件说明

### /frontend/src/utils/concurrency.ts（feat 独有）

- 功能：提取 ConcurrencyPanel 和 MonitorHeader 共用的并发计算工具函数（`effectiveLimit`、`concurrencyBarClass`、`concurrencyRatioClass`）
- 来源：从 ConcurrencyPanel.vue 和 MonitorHeader.vue（feat）中提取出的共享逻辑
- main 分支无此文件，相关函数分别在 ConcurrencyPanel.vue 中本地定义

---

## 移除文件说明

无文件被移除。5 个文件在两个分支中均存在。`ConcurrencyPanel.vue` 在 feat 中虽然文件存在，但已不在 `Monitor.vue` 中使用（逐 Provider 并发改为在 MonitorHeader 中内联展示）。

---

## 全局差异汇总

| 文件 | 差异类型 | 影响等级 |
|------|---------|---------|
| Monitor.vue | 功能变更 + 新增功能 | 高 |
| MonitorHeader.vue | 功能变更（职责重组） | 高 |
| RuntimePanel.vue | 功能变更 + activeRequests 缺失 | 中 |
| ConcurrencyPanel.vue | 代码重构（工具提取） | 低 |
| ProviderStatsTable.vue | 仅样式重构 | 低 |

### 需关注的功能等价性风险

1. **`RuntimePanel` 缺少 `runtime.activeRequests` 展示**：原来在 RuntimePanel 中展示的活跃请求数（来自 runtime 数据源）在 feat 中无对应替代展示。此数字可能不同于列表中的 streamingRequests 计数（来自请求列表数据源），需要确认是否有用户依赖此差异。
2. **Kill 按钮条件收紧**：feat 仅对 `status === "pending"` 的请求显示 Kill 按钮，main 无条件显示。需确认后端 kill endpoint 的约束。
3. **SSE 生命周期封装**：feat 将 `useMonitorSSE` 调用从页面层移到 composable 内部。当前行为等价，但需要验证 composable 的 `connect()` 是否在页面热更新时正确重连（Vue HMR 场景下 composable ref 可能重置）。

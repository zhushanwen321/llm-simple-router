# 分组 11: Monitor — Status & SSE

## 审查结论
有差异

## 差异详情

### 文件: frontend/src/components/monitor/StatusCodePanel.vue

- 差异类型: 代码重构
- 详细说明:
  - **布局完全不同**：feat 使用紧凑水平行内布局（色点 + 类别 + 计数 + 百分比），main 使用垂直布局（标签 + 计数/百分比 + 进度条）。核心计算逻辑（4 个状态码分组、百分比计算、`sumRange` 函数、`.filter(g => g.count > 0)`）完全一致。
  - **标签方式不同**：feat 使用硬编码标签 "2xx" / "4xx" / "429" / "5xx"，main 使用 i18n key `t('monitor.statusCodes.success')` / `t('monitor.statusCodes.clientError')` 等。feat 不依赖翻译 key 即能正常展示，功能等价。
  - **样式 Token 不同**：feat 使用语义 CSS token（`text-success` / `bg-success` 等），main 使用硬编码 Tailwind 颜色类（`text-green-600 dark:text-green-400` 等）。这是设计系统升级，不影响功能。
  - **代码质量**：feat 使用命名常量（`HTTP_2XX_START` / `PERCENT_100` 等）替代 magic number，main 依赖 `eslint-disable no-magic-numbers` 注解。不影响功能。
- 影响评估: 低（布局变更属设计重做，数据计算逻辑未变）

---

### 文件: frontend/src/composables/useMonitorData.ts

- 差异类型: 架构变更 + Bug 修复
- 详细说明:
  1. **SSE 生命周期封装内聚**：feat 在 `useMonitorData` 内部直接调用 `useMonitorSSE`，对外只暴露 `connect` / `disconnect`。main 对外暴露 `handleSSEMessage` / `handleSSEOpen` / `handleSSEClose`，由消费者（Monitor.vue）自行与 `useMonitorSSE` 对接。feat 的封装更内聚，消除了消费者的样板代码。**APIs 不变**（connect/disconnect 签名未变），仅是导出差异。
  2. **`request_start` 事件缺少 `triggerRef`（main 的 Bug，feat 已修复）**：main 在 `request_start` 处理中对 `activeRequests`（shallowRef 的数组）执行 `.unshift()` 后未调用 `triggerRef()`，Vue 的 shallowRef 不会自动追踪数组 mutation，导致 UI 可能不响应新请求的添加。feat 新增了 `triggerRef(deps.activeRequests)` 调用。**这是 main 的 bug，feat 已修复。**
  3. **函数提取**：feat 将 `handleSSEMessage` 和 `loadInitialData` 的逻辑提取为模块级函数 `handleSSEMessageImpl` / `loadInitialDataImpl`，传入 deps 对象。函数体逻辑与 main 完全一致，纯粹是行数缩减重构。
  4. **不再导出 SSE handler**：feat 不再在 return 中包含 `handleSSEMessage` / `handleSSEOpen` / `handleSSEClose`。main 需要这些用于手动对接 `useMonitorSSE`，feat 因内部分配而无需导出。
- 影响评估: 中（消费者 API 变化 + bug 修复）

---

### 文件: frontend/src/composables/useMonitorSSE.ts

- 差异类型: 代码重构
- 详细说明:
  - feat 引入命名常量 `EXPONENTIAL_BASE = 2` 替代 main 中的 magic number `2`（main 用 `eslint-disable-next-line no-magic-numbers` 注解绕过规则）。
  - 引号风格从单引号改双引号（prettier 格式化差异）。
  - **业务逻辑完全一致**：visibility 页面隐藏断开、指数退避重连、连接状态管理、onUnmounted 清理等全部一致。
- 影响评估: 低（纯代码质量优化，无功能变化）

---

### 文件: frontend/src/views/metrics-helpers.ts

- 差异类型: 新增功能 + 功能变更
- 详细说明:
  1. **新增 `miniLineOptions()` 函数**：feat 新增了一个简化版折线图配置生成函数，用于底部小图（无 Y 轴刻度/网格，无 legend）。main 中没有此函数。这是 feat 的新功能，用于支持新增的监控图表组件。
  2. **`stackedAreaOptions` 配置增强**：feat 的 legend 配置更详细：
     - legend 位置从 `"bottom"` 改为 `"top"`，并增加了 `align: "start"`
     - 新增 `usePointStyle: true` / `pointStyle: "circle"` / `boxWidth: 8` / `boxHeight: 8` / `padding: 16` 等样式配置
     - main 仅有基础 `labels: { color: colors.tickColor }`
  3. **其他函数一致**：`fillTimeseries`、`lineOptions`、`tickIndices`、`makeXTickCallback`、`chartThemeColors`、`isDarkMode` 等全部辅助函数在两分支中逻辑完全一致。
- 影响评估: 低（新增辅助函数 + legend 样式微调，不影响现有图表功能）

---

## 新增文件说明

无。

## 移除文件说明

无。

---

## 总结

| 文件 | 差异类型 | 严重度 | 说明 |
|------|---------|--------|------|
| StatusCodePanel.vue | 布局重构 | 低 | 布局/样式完全重做，数据计算逻辑不变 |
| useMonitorData.ts | 架构变更 + Bug 修复 | 中 | SSE 封装内聚 + 修复 shallowRef unshift 缺少 triggerRef |
| useMonitorSSE.ts | 代码重构 | 低 | 命名常量替代 magic number，逻辑不变 |
| metrics-helpers.ts | 新增功能 + 微调 | 低 | 新增 miniLineOptions + 增强 stackedAreaOptions legend |

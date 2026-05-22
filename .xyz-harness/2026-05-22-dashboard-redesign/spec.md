---
verdict: pass
---

# Dashboard Redesign: Anchor + Panel

## Background

Dashboard.vue 当前是教科书级的 AI 模板仪表盘：6 张完全相同的指标卡片（big number + small label）、3 张完全相同的折线图、零差异化视觉权重。Critique 评分 23/40，核心问题包括：

- **P0**：数据值未使用等宽字体（违反 Data-Is-Mono Rule）
- **P0**：6 张卡片无视觉层次（AI slop 核心特征）
- **P1**：筛选器控件过多（5 组），首屏被配置占领
- **P1**：3 张折线图视觉重复
- **P2**：空状态和加载态无帮助
- **P2**：无数据新鲜度指示

用户已确认采用 **Anchor + Panel** 方案：成功率作为页面锚点，其余指标内联到锚点面板，输入/输出 token 合并为一张叠加面积图。

## Functional Requirements

### FR1: Health Anchor 区域

页面顶部为 Health Anchor 区域，占据整行宽度，包含：

- 左侧：`Success Rate` 标签 + 大字号等宽数值（48px mono）+ 健康状态 Badge（条件着色：>=99% 绿色 "Healthy"、>=95% 黄色 "Degraded"、<95% 红色 "Critical"）
- 右侧：4 个次要指标水平排列（Avg TPS、Input Tokens、Output Tokens、Cache Hit Rate），每个用 `metric-value-sm`（20px mono）显示数值
- Anchor 区域下方显示请求总数和时间范围描述（如 "12,847 requests in last 5 hours"）

条件着色阈值：
- `successRate >= 0.99` → success 色（`--color-success`），Badge 文本 "Healthy"
- `0.95 <= successRate < 0.99` → warning 色（`--color-warning`），Badge 文本 "Degraded"
- `successRate < 0.95` → danger 色（`--color-danger`），Badge 文本 "Critical"
- `totalRequests === 0` → muted 色（`--color-text-tertiary`），Badge 文本 "No Data"

### FR2: 数据值等宽字体

所有指标数值必须使用 `font-mono`（JetBrains Mono），包括：
- Health Anchor 中的所有数值（success rate、TPS、token counts、cache hit rate）
- 图表区域中不存在额外数值显示需求（Chart.js 内部渲染不受 CSS font-family 影响）

标签文本（如 "Success Rate"、"Avg TPS"）保持 body font（Geist）不变。

### FR3: 筛选器重排

将当前 5 组筛选器重构为：

1. **Period Tabs**（保持不变）：5h / Weekly / Monthly / Custom，使用 `period-tabs` 组件（圆角背景组）
2. **Provider Select**：从按钮组改为 `<Select>` 下拉框，解决 20+ Provider 溢出问题。默认选中 token 输出量最高的 Provider
3. **Model Select**（保持）
4. **Key Select**（保持）
5. **Client Type Select**（保持）

移除 Provider 按钮组（`v-for p in sortedProviders` 的 Button 行），替换为单个 Select。Select 选项按 token 输出量降序排列，第一个选项为 "All Providers"。

Provider Select 默认值规则（按优先级）：
1. metrics 数据可用时（`providerOutputTokens` 非空）：自动选中 token 输出量最高的 Provider
2. metrics 数据为空（首次加载、全零输出、加载失败）：选中列表中第一个 Provider（按 `providers` 数组原始顺序）
3. Provider 列表为空（无任何 Provider）：Select 显示 disabled 状态，页面显示引导文案 "No providers configured. Add a provider to get started."

筛选栏右侧添加 `Updated at HH:MM:SS` 时间戳，每次数据刷新时更新。

### FR4: 图表合并

将当前 3 张独立折线图（TPS / Input Tokens / Output Tokens）改为 2 张：

1. **Token Throughput**（左，占 50%）：叠加面积图，Input 和 Output 两条数据系列叠加在同一个坐标系中。Input 使用 teal 色（`CHART_COLORS.teal`），Output 使用 green 色（`CHART_COLORS.green`）。图例显示在图表内左上角
2. **Output Speed (TPS)**（右，占 50%）：保持当前折线图形式，使用 indigo 色（`CHART_COLORS.indigo`）

Token Throughput 图表使用 `stackedAreaOptions()`（已在 `metrics-helpers.ts` 中定义），将两条数据系列合并为一个 `ChartData<"line">` 对象，两个 dataset 均设置 `fill: true` 和 `stacked: true`。

### FR5: 空状态改进

根据数据状态提供具体的空状态文案：

- **零请求（totalRequests === 0）**：Health Anchor 成功率显示 "—"，Badge 显示 "No Data"（muted 色），次指标全部显示 "—"，Anchor 下方显示 "No requests in this period"
- **筛选无结果**：在 Health Anchor 成功率显示 "—"，Badge 显示 "No Data"（muted 色），次指标全部显示 "—"，Anchor 下方显示 "No data for the selected filters"
- **加载中**：在 Health Anchor 数值位置显示 Skeleton（而不是 "Loading..." 文本），保持布局不跳动
- **加载失败**：保持当前 retry 按钮，错误文案改为具体描述（如 "Failed to load dashboard data"）

### FR6: 数据新鲜度指示

在筛选栏最右侧添加 `Updated at HH:MM:SS` 文本，使用 `font-mono` + `text-xs` + `text-muted-foreground` 样式。每次 `refresh()` 成功完成后更新时间戳。

### FR7: DESIGN.md 合规修复

- **按钮尺寸**：Period Tabs 保持当前 compact 尺寸（`period-tab` 自定义样式，28px）。所有 Select 组件（Provider、Model、Key、Client Type）统一使用默认高度 32px（不传 `size` prop）
- **状态色语义**：移除缓存命中率的 `text-primary` 着色，改为 neutral foreground 色。缓存命中率不是交互元素，不应使用主色
- **成功率着色**：使用条件着色（FR1），而非固定的 `text-success`。成功率的颜色应反映实际健康程度

## Acceptance Criteria

### AC1: Health Anchor 布局
- [ ] 页面顶部有一个占据整行宽度的 Anchor 区域
- [ ] 左侧显示 Success Rate 标签 + 等宽大数值 + 条件着色 Badge
- [ ] 右侧水平排列 4 个次要指标，每个用 20px mono 显示
- [ ] 成功率 >=99% 时 Badge 显示 "Healthy" 且为绿色
- [ ] 成功率在 95%-99% 之间时 Badge 显示 "Degraded" 且为黄色
- [ ] 成功率 <95% 时 Badge 显示 "Critical" 且为红色
- [ ] 请求总数为 0 时 Badge 显示 "No Data" 且为 muted 色

### AC2: 等宽字体
- [ ] Health Anchor 中所有数值使用 `font-mono`（JetBrains Mono）
- [ ] 标签文本保持 body font（Geist）

### AC3: Provider Select
- [ ] Provider 选择器从按钮组改为 Select 下拉框
- [ ] Select 选项包含 "All Providers" 作为第一项
- [ ] Select 选项按 token 输出量降序排列
- [ ] 默认选中 token 输出量最高的 Provider
- [ ] 20+ Provider 时 Select 不溢出，正常工作

### AC4: 图表合并
- [ ] 输入/输出 token 合并为一张叠加面积图
- [ ] TPS 保持独立折线图
- [ ] 叠加面积图有两条数据系列和图例
- [ ] 两张图表各占 50% 宽度，等高

### AC5: 空状态
- [ ] 零请求时成功率显示 "—"，Badge 显示 "No Data"（muted 色），次指标显示 "—"，下方文案 "No requests in this period"
- [ ] 筛选无结果时成功率显示 "—"，Badge 显示 "No Data"（muted 色），下方文案 "No data for the selected filters"
- [ ] 加载中时数值位置显示 Skeleton，布局不跳动

### AC6: 数据新鲜度
- [ ] 筛选栏右侧显示 "Updated at HH:MM:SS"
- [ ] 每次数据刷新后时间戳更新
- [ ] 时间戳使用 mono font

### AC7: 状态色修复
- [ ] 缓存命中率使用 foreground 色（非 primary）
- [ ] 成功率使用条件着色（非固定 success 色）
- [ ] 页面上没有非交互元素使用 `text-primary`

## Constraints

- **技术栈**：Vue 3.5 + TypeScript + chart.js 4.5 + vue-chartjs 5.3 + shadcn-vue + Tailwind CSS
- **不修改后端 API**：所有数据来源于现有 `getStats`、`getMetricsSummary`、`getMetricsTimeseries` 端点
- **不引入新依赖**：使用已有的 chart.js + shadcn-vue 组件
- **保持 composable 模式**：`useDashboard.ts` 继续作为状态管理核心，可以重构内部实现但不改变导出接口的语义
- **i18n**：所有新文案必须通过 vue-i18n `t()` 函数
- **暗色优先**：所有设计决策以暗色模式为基准，亮色模式必须同时正常工作
- **DESIGN.md 合规**：遵循 Single Accent Rule、Data-Is-Mono Rule、Flat-By-Default Rule

## Out of Scope

- 不修改 `metrics-helpers.ts` 中的图表配置函数签名（`lineOptions`、`stackedAreaOptions`、`fillTimeseries` 可调整参数但保持导出）
- 不修改路由或导航结构
- 不添加新的后端 API 端点
- 不做响应式适配（移动端布局不在本次范围）
- 不添加键盘快捷键或自定义布局功能
- 不修改 Monitor.vue 或 Logs.vue（它们有自己的 composable）

## Complexity Assessment

**中等复杂度**。改动集中在单个 Vue 文件（`Dashboard.vue`）和单个 composable（`useDashboard.ts`），不涉及后端或跨页面改动。主要工作量在：

1. Dashboard.vue 模板重构（Anchor 布局 + 图表合并）：中等
2. useDashboard.ts 适配（Provider Select 数据源、Token 合并 chart data）：简单
3. 空状态和新鲜度指示：简单
4. DESIGN.md 合规修复（font-mono、颜色修正）：简单

预计修改文件：`Dashboard.vue`（主要）、`useDashboard.ts`（次要）、i18n JSON（文案新增）。不改 backend、不改路由、不改其他页面。

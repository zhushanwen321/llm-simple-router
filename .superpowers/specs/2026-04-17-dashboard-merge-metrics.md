# 仪表盘合并性能指标 — 设计文档

## 目标

将独立的 `/metrics` 性能指标页面合并到 `/` 仪表盘页面，删除 `/metrics` 路由和 `Metrics.vue`。

## 合并后页面结构

```
[标题 "仪表盘" + 控制栏: 周期按钮(1h/6h/24h/7d/30d) | 模型筛选 | 密钥筛选]
[统计卡片行: 总请求数 | 成功率 | 平均延迟 | 24h请求数]
[图表行1: Token 使用量(堆叠面积图) | 吞吐量(折线图)]    ← lg:grid-cols-2
[图表行2: 首 Token 延迟(折线图) | 缓存命中率(折线图)]  ← lg:grid-cols-2
[模型对比表]
```

## 需求确认

| 项目 | 决定 |
|------|------|
| 统计卡片 | 保留在页面顶部 |
| 请求分布柱状图 | 去掉 |
| 控制栏 | 保留全部筛选（周期+模型+密钥） |
| 图表排列 | 第一行：Token使用量+吞吐量，第二行：TTFT+缓存命中率，均 2 列 |
| 模型对比表 | 保留在底部 |
| `/metrics` 路由 | 删除 |

## 技术方案

### 数据层

仪表盘需要同时加载 stats 数据和 metrics 数据。将 `useMetrics()` composable 直接在 `Dashboard.vue` 中调用，同时保留原有的 stats 加载逻辑。

两个数据源独立加载、互不阻塞：
- stats：调用 `api.getStats()`，受密钥筛选控制
- metrics：调用 `useMetrics()`，受周期/模型/密钥筛选控制

**筛选器联动**：密钥筛选同时影响 stats 和 metrics。Dashboard 维护一个统一的 `routerKeyFilter` ref，通过 `watch` 同步到 `useMetrics()` 返回的 `routerKeyFilter`，同时触发 `loadStats()`：

```ts
const dashboardKeyFilter = ref('all')
const metrics = useMetrics()

watch(dashboardKeyFilter, (v) => {
  metrics.routerKeyFilter.value = v
  loadStats()
})
```

**密钥列表去重**：复用 `useMetrics()` 中的 `routerKeys`，Dashboard 不再独立加载密钥列表。

**Loading 状态**：使用两个独立 loading ref — `statsLoading` 和 metrics 的 `loading`。页面顶部加载指示器使用 `statsLoading || loading`（任一在加载即显示）。stats 区域和图表区域各自独立处理空/错误状态。

### 组件变更

**Dashboard.vue** — 合并主战场：
- 引入 `useMetrics()` composable
- 引入 Chart.js 注册和 `Line` 组件
- 顶部控制栏：周期按钮 + 模型筛选 + 统一密钥筛选
- 模板：统计卡片 → 4 个图表 Card（2x2 grid）→ 模型对比表
- 统一密钥筛选 ref，watch 同步到 metrics 并触发 stats 刷新

**Metrics.vue** — 删除。

**metrics-helpers.ts** — 保留，不变。

**useMetrics.ts** — 无需改动。Dashboard 通过赋值 `metrics.routerKeyFilter.value` 触发其内部 watch。

### 路由变更

- `frontend/src/router/index.ts`：删除 `/metrics` 路由定义
- `frontend/src/components/layout/Sidebar.vue`：删除 `{ path: '/metrics', label: '性能指标', icon: BarChart3 }` 导航项
- 删除 `frontend/src/views/Metrics.vue`

### 导航栏

合并后侧边栏从 7 项变为 6 项：
```
仪表盘 | 供应商 | 模型映射 | API 密钥 | 重试规则 | 请求日志
```

## 图表布局变更

原 Metrics.vue 中 Token 使用量和缓存命中率各占整行（`lg:col-span-2`），合并后改为与其他图表一致的单列（2x2 grid）。这是有意的调整 — 4 个图表统一尺寸，视觉更平衡。

## 风险点

- **并发请求**：页面加载时 stats（1 请求）+ metrics（7 请求）同时发出，但均为轻量查询，无性能顾虑。
- **失败隔离**：stats 和 metrics 各有独立 error handling，互不影响。metrics 有 `noData` 空状态，stats 有 catch fallback。
- **页面高度**：合并后内容较多，但所有图表区域有固定高度（h-64），模型对比表在底部自然流动，不会有布局问题。

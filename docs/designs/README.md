# UI 交互原型 & 组件库

管理后台所有页面的 HTML 交互原型和抽离的可复用组件库。

## 页面原型

打开 `index.html` 查看所有 demo 的目录页。

| 文件 | 页面 | 对应路由 |
|------|------|---------|
| `demo-dashboard.html` | 仪表盘 | `/` |
| `demo-monitor.html` | 实时监控 | `/monitor` |
| `demo-logs.html` | 请求日志 | `/logs` |
| `demo-providers.html` | Provider 管理 | `/providers` |
| `demo-mappings.html` | 模型映射（主方案） | `/mappings` |
| `demo-mappings-A-pipeline-list.html` | 映射方案 A：管线列表 | — |
| `demo-mappings-B-table-expand.html` | 映射方案 B：表格展开 | — |
| `demo-mappings-C-split-panel.html` | 映射方案 C：分栏面板 | — |
| `demo-quick-setup.html` | 快速配置 | `/quick-setup` |
| `demo-retry-rules.html` | 重试规则 | `/retry-rules` |
| `demo-router-keys.html` | 路由密钥 | `/router-keys` |
| `demo-schedules.html` | 定时计划 | `/schedules` |
| `demo-proxy-enhancement.html` | 代理增强 | `/proxy-enhancement` |
| `demo-sidebar.html` | 侧边栏 | 全局 |
| `demo-components.html` | 组件库展示页 | — |

## 组件库

`components/` 目录下是抽离的可复用 CSS/JS 组件。新 demo 页面引入即可使用。

```html
<link rel="stylesheet" href="components/tokens.css">
<link rel="stylesheet" href="components/l0-atoms.css">
<link rel="stylesheet" href="components/l1-composites.css">
<link rel="stylesheet" href="components/l2-patterns.css">
<script src="components/l1-composites.js"></script>
```

| 文件 | 层级 | 组件数 | 说明 |
|------|------|--------|------|
| `tokens.css` | — | — | 设计令牌（暗/亮模式 CSS 变量 + 重置 + 工具类） |
| `l0-atoms.css` | L0 | 17 | 原子组件：Button, Input, Badge, Switch, CopyButton 等 |
| `l1-composites.css` | L1 | 18 | 复合组件：Card, Table, Dialog, Tabs, Collapsible 等 |
| `l1-composites.js` | L1 | 6 | 交互行为：openDialog, switchTab, copyText 等 |
| `l2-patterns.css` | L2 | 13 | 业务模式：StatusBadge, MetricCard, StatsStrip 等 |

`demo-components.html` 是组件库的交互展示页（类 Storybook）。

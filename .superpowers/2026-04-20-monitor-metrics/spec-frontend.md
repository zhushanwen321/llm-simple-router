---
name: monitor-frontend
description: 前端组件拆分和路由设计
type: project
---

# 前端组件

## 页面结构

主页面 `Monitor.vue` 采用双栏布局：

```
┌─────────────────────────────────────────────────┐
│ MonitorHeader (概览卡片: 活跃数/错误率/延迟/重试率) │
├──────────────────────┬──────────────────────────┤
│ ActiveRequestList    │ RequestDetailPanel       │
│ (左侧请求列表)        │ (右侧详情)               │
│                      │                          │
│  活跃请求             │  请求头信息 + 指标网格     │
│  最近完成 (虚线分隔)   │  流式响应查看器           │
│                      │  重试历史                 │
│                      │  客户端/上游请求 (折叠)    │
├──────────────────────┴──────────────────────────┤
│ ProviderStatsTable (按 provider 聚合统计)         │
└─────────────────────────────────────────────────┘
```

## 组件列表

```
frontend/src/views/Monitor.vue
frontend/src/components/monitor/
  ├── MonitorHeader.vue           ← 概览卡片
  ├── ActiveRequestList.vue       ← 请求列表（活跃 + 最近完成）
  ├── RequestDetailPanel.vue      ← 请求详情面板
  ├── ConcurrencyPanel.vue        ← 并发度进度条
  ├── RuntimePanel.vue            ← 运行时指标
  ├── StatusCodePanel.vue         ← 状态码分布
  ├── ProviderStatsTable.vue      ← Provider 统计表
  └── StreamResponseViewer.vue    ← 流式响应三种视图
```

## 路由

在 `router/index.ts` 添加：`/admin/monitor` → `Monitor.vue`

## 数据流

1. 页面加载 → 调用 REST API 获取初始快照
2. 建立 `EventSource('/admin/api/monitor/stream')` 连接
3. 收到 SSE 事件 → 增量更新组件状态
4. 点击请求 → 右侧面板展示详情（从内存状态中读取）

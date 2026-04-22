---
name: monitor-metrics-spec
description: 实时监控仪表盘设计规格 — 活跃请求追踪、并发度监控、统计聚合、SSE 推送
type: project
---

# 实时监控仪表盘设计规格

## 概述

在管理后台新增"实时监控"页面，提供实时运维仪表盘。纯内存状态跟踪 + SSE 推送，不增加 DB 写入。

**Why:** 当前系统缺少运行时可见性，无法实时观察请求状态、并发瓶颈、重试情况。

## 核心决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 实时推送方式 | SSE | 与项目已有的 SSE 代理模式一致，实现简单 |
| 活跃请求存储 | 纯内存 | 瞬时状态无需持久化，重启后自然清空 |
| 统计聚合 | 内存 ring buffer | 不增加 DB 写入压力 |
| 推送频率 | 统一 5s 定时 | 避免高频推送，实现简单 |
| 统计维度 | 按 provider 聚合 | 最自然的监控粒度 |
| 流式指标桥接 | SSEMetricsTransform onMetrics 回调 | 不侵入 retryableCall 内部，回调节流 5s |
| 请求状态 | pending/completed/failed（无 retrying） | 不侵入 retryableCall 内部，无法实时感知重试 |

## 架构

```
RequestTracker (内存单例)
  ├── ActiveRequest[]      ← 活跃 + 最近完成的请求
  ├── StatsAggregator      ← ring buffer + 分位数计算
  ├── SSE ClientManager    ← 连接集合 + 定时广播
  └── RuntimeCollector     ← Node.js 指标采集

handleProxyPost() 埋点:
  start() → update() → complete()
  ↓
SSE 定时广播 (5s):
  request_update + concurrency_update + stats_update
  runtime_update (10s)
```

## 子文档

- [数据模型](spec-data-model.md) — ActiveRequest、StatsSnapshot、RuntimeMetrics 等类型定义
- [SSE 推送机制](spec-sse-push.md) — 事件类型、端点、频率控制
- [埋点设计](spec-instrumentation.md) — proxy-core.ts 中的埋点位置和 RequestTracker 接口
- [前端组件](spec-frontend.md) — 页面结构、组件拆分、路由
- [Mockup](mockup-overview.html) — 概览布局 HTML
- [详情 Mockup](mockup-detail.html) — 请求详情面板 HTML（含流式响应三种视图）

## 修正记录

- 删除 `ActiveRequest.status` 的 `"retrying"` 状态，简化为 `pending | completed | failed`
- 流式指标通过 `SSEMetricsTransform` 新增 `onMetrics` 回调实时获取
- `ProviderConcurrencySnapshot` 数据来源：semaphore + provider 配置缓存
- SSE 连接管理补充断开检测和 write 异常处理
- SSE 认证基于 Cookie（原生 EventSource 可用）

## How to apply

实现顺序：RequestTracker → 埋点 → SSE 端点 → REST 端点 → 前端组件。

---
verdict: pass
---

# E2E Test Plan — Metrics Aggregation + Dashboard Refactor

## Test Scenarios

### TS-1: 聚合表双写（AC-1）
1. 发送 OpenAI chat completions 请求（非流式），确认返回 200
2. 查询 `metrics_10min` 表，确认对应桶行 `request_count = 1`
3. 发送第二个请求（同一分钟、同一 provider+model），查询桶行 `request_count = 2`
4. 发送 Anthropic 请求（不同 api_type），确认不同桶行

### TS-2: Metrics 保留配置（AC-2）
1. `GET /admin/api/settings/metrics-detail-days` → 黔回 `{ days: 7 }`
2. `PUT /admin/api/settings/metrics-detail-days` body `{ days: 3 }` → 返回 `{ days: 3 }`
3. `PUT` body `{ days: 100 }` → 返回 400
4. `PUT` body `{ days: 50 }` 且 `log_retention_days = 30` → 返回 400

### TS-3: 时间选择器 UI（AC-3）
1. Dashboard 页面加载 → 显示 24h 快速按钮 + 活动图
2. 点击 7d → 统计卡片和图表刷新，时间标签显示 7 天范围
3. 点击 Custom → 展开日期输入行 → 选择过去 14 天 → Apply → 图表刷新
4. 活动图拖拽 handle → 选区范围变化 → 图表刷新

### TS-4: 查询路由（AC-4）
1. 设置 `metrics_detail_days = 7`
2. 选择 5h 时间范围 → 验证 API 响应 < 100ms
3. 选择 30d 时间范围 → 验证 API 响应 < 100ms
4. 选择 10d（跨分界线） → 验证数据不重复不遗漏

### TS-5: 清理逻辑（AC-5）
1. 设置 `metrics_detail_days = 1`，`log_retention_days = 30`
2. 插入 >1 天前的 metrics 明细行
3. 触发清理 → 确认明细行被删除、聚合表数据保留

### TS-6: 向后兼容（AC-6）
1. `GET /admin/api/usage/windows` 仍返回 200（不报错）
2. 旧版日志详情页正常显示（>detail_days 的日志无 metrics 指标，不报错）
3. 升级后不执行数据迁移，旧 metrics 明细自然过期

## Test Environment

- Docker 部署（NUC5 环境）
- SQLite 数据库（含 ~1500 request_logs + ~216K request_metrics）
- 前端 Chrome 浏览器
- 使用 `buildApp({ db: initDatabase(":memory:") })` 进行组件测试

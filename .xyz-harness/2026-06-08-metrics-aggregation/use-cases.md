---
verdict: pass
---

# Use Cases — Metrics Aggregation

## UC-1: 查看近期性能趋势
- **Actor**: 系统管理员
- **Preconditions**: 系统运行 >24h，request_metrics 有数据
- **Main Flow**:
  1. 打开 Dashboard 页面
  2. 默认选中 24h 时间范围
  3. 查看统计卡片（Input/Output Tokens、TPS、Cache Hit）
  4. 查看 Token Throughput 折线图
- **Alternative Paths**: 无数据时统计卡片显示 0，图表显示 "No data"
- **Postconditions**: 所有数据来自明细表（≤detail_days），响应 < 100ms
- **Module Boundaries**: useTimeSelector → useDashboardData → API → metrics.ts → request_metrics

## UC-2: 分析月度用量
- **Actor**: 系统管理员
- **Preconditions**: 系统运行 >30 天，metrics_10min 有聚合数据
- **Main Flow**:
  1. 点击 30d 快速按钮
  2. 活动图高亮聚合区域（斜线阴影）
  3. 统计卡片展示 30 天汇总数据
  4. 切换 Provider 筛选查看各供应商用量
- **Alternative Paths**: 聚合表为空时活动图显示空白提示
- **Postconditions**: 数据来自 metrics_10min 聚合表，响应 < 100ms
- **Module Boundaries**: useTimeSelector → useDashboardData → API → metrics-10min.ts → metrics_10min

## UC-3: 调整 metrics 保留策略
- **Actor**: 系统管理员
- **Preconditions**: 已登录管理后台
- **Main Flow**:
  1. 打开 Settings 页面
  2. 修改 Metrics Detail 从 7 改为 3
  3. 点击 Save Changes
  4. toast 提示保存成功
  5. 下个清理周期（≤1h）自动删除 >3 天的明细
- **Alternative Paths**: metrics detail > log retention → 表单校验失败，显示错误
- **Postconditions**: settings 表 `metrics_detail_days = 3`，清理逻辑生效
- **Module Boundaries**: Settings.vue → useLogRetention → settings-api → admin/settings.ts → settings table

## UC-4: 自定义时间范围对比
- **Actor**: 系统管理员
- **Preconditions**: 系统运行 >14 天
- **Main Flow**:
  1. 点击 Custom 按钮，展开日期输入行
  2. 选择 From = 6/1、To = 6/7，点击 Apply
  3. 查看数据后，再选 From = 6/8、To = 6/14
  4. 对比两周数据
- **Alternative Paths**: 日期范围 > 90 天 → 显示错误提示
- **Postconditions**: 图表展示自定义范围数据
- **Module Boundaries**: useTimeSelector → useDashboardData → API → 查询路由分流

### UC-AC 覆盖映射

| UC | 覆盖 AC |
|----|---------|
| UC-1 | AC-3（时间选择器）、AC-4（查询路由 ≤detail） |
| UC-2 | AC-3（30d 快速按钮）、AC-4（查询路由 >detail） |
| UC-3 | AC-2（保留配置）、AC-5（清理逻辑） |
| UC-4 | AC-3（Custom 日期选择）、AC-4（跨分界线查询） |

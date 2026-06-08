# Backend Plan 执行摘要

## 产出文件

| 文件 | 说明 |
|------|------|
| `plan-backend.md` | 后端实施计划（Task BG1-BG4、迁移 SQL、双写改造、查询路由、清理扩展） |
| `plan-api-contract.md` | API 契约（新增/修改端点、共享类型、配置生命周期） |

## 关键源文件读取清单

| 文件 | 读取目的 |
|------|---------|
| `router/src/db/metrics.ts` | insertMetrics 签名、MetricsInsert 类型、查询函数签名 |
| `router/src/db/stats.ts` | getStats 签名、Stats 返回类型 |
| `router/src/db/usage-windows.ts` | getWindowUsage 签名（N+1 问题定位） |
| `router/src/db/settings.ts` | getSetting/setSetting 模式、缓存机制 |
| `router/src/db/log-cleaner.ts` | runLogCleanup 签名、scheduleLogCleanup 模式 |
| `router/src/admin/metrics.ts` | metrics 路由注册、resolveMetricsTime 逻辑 |
| `router/src/admin/usage.ts` | getDailyUsage 签名、usage 路由注册 |
| `router/src/admin/settings.ts` | settings 路由注册模式 |
| `router/src/proxy/proxy-logging.ts` | insertMetrics 调用点（collectTransportMetrics） |
| `router/src/utils/time-range.ts` | resolveTimeRange 逻辑 |

## 核心设计决策

1. **聚合表 WITHOUT ROWID**：主键已覆盖所有查询场景，省去 rowid 开销
2. **router_key_id NULL → '' 转换**：UNIQUE 约束中 NULL ≠ NULL 导致冲突检测失败，用空字符串替代
3. **聚合表不保留 status_code**：success_rate 在聚合段近似为 100%，明细段精确
4. **不回填历史数据**：聚合表从迁移后开始积累，空表时活动图显示 "No data yet"
5. **deleteMetricsBefore 放在 metrics.ts**：数据归属原则，log-cleaner 只负责调用
6. **查询路由读取 settings 缓存**：复用现有 30s TTL 缓存，避免每次查询读 settings 表

## L2 后端设计指导遵循情况

- ✅ Task 粒度对应 subagent 调度（BG1-BG4 各一个 subagent 链）
- ✅ 接口签名表（新增/修改函数签名、参数类型、返回类型）
- ✅ DB 迁移 SQL 骨架（完整 DDL + UPSERT 语句）
- ✅ 禁止函数体/完整类定义（仅签名 + SQL 模板）
- ✅ 文件路径精确到具体文件

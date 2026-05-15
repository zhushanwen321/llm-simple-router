# Plan: 映射原因追踪 (Mapping Reason Tracking)

## 复杂度: L2

跨后端 6 文件 + 前端 5 文件，涉及类型定义、映射解析、pipeline snapshot、SSE 推送、前端解析和展示。

详细计划分文件：
- [后端计划](plan-backend.md) — 6 个 Task
- [前端计划](plan-frontend.md) — 5 个 Task

## Task 执行顺序

```
=== 后端（顺序执行）===
B1: types.ts — MappingReason type + ResolveResult 扩展
B2: monitor/types.ts — ActiveRequest 新增 mappingReason
B3: pipeline-snapshot.ts — StageRecord routing variant 新增 mapping_reason
B4: mapping-resolver.ts — 4 个返回路径填充 mappingReason
B5: orchestrator.ts — OrchestratorConfig + buildActiveRequest 传递 mappingReason
B6: failover-loop.ts — BP-H2 缓存扩展 + 后置覆写 + 写入 snapshot + 传递 mappingReason

=== 前端（可部分并行）===
F1: logs/types.ts — LogEntry 新增 pipeline_snapshot          ┐
F3: monitor.ts — 前端 ActiveRequest 新增 mappingReason       ├→ 可并行
F5: i18n — 6 个翻译键                                        ┘
F2: request-detail/types.ts — parseMappingReason + 转换器     ← 依赖 F1, F3
F4: RequestOverviewPanel.vue — Badge 展示                     ← 依赖 F2, F5

=== 测试 ===
T1: 后端单元测试 — resolveMapping 4 种路径 + failover-loop 覆写
T2: 前端单元测试 — parseMappingReason 防御性解析
```

## 关键风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| BP-H2 缓存丢失 mappingReason | 第 2+ 次 failover 迭代映射原因为 undefined | 缓存中同步保存 mappingReason（Task B6） |
| SSE request_start 时 mappingReason 未就绪 | Monitor 首次推送无映射原因 | 可接受：mapping 在毫秒级完成，request_update（5s）会携带 |
| orchestrator.ts 未在 spec 中列出 | ActiveRequest 构建在此文件 | Task B5 显式修改 |
| LogEntry 类型缺少 pipeline_snapshot | fromLogEntry 无法读取 | Task F1 补充类型声明 |

## AC 覆盖矩阵

| AC | 后端 Task | 前端 Task |
|----|----------|----------|
| AC1 direct_format | B1, B4 | F2, F4, F5 |
| AC2 group_base_rule | B1, B4 | F2, F4, F5 |
| AC3 group_schedule | B1, B4 | F2, F4, F5 |
| AC4 fallback_provider | B1, B4 | F2, F4, F5 |
| AC5 overflow_redirect | B3, B5, B6 | F2, F4, F5 |
| AC6 failover_retry | B6 | F2, F4, F5 |
| AC7 双页面一致 | B5, B6 | F2 |
| AC8 历史数据降级 | B3(optional 字段) | F2, F4 |
| AC9 DB 查询验证 | B3, B4, B6 | — |

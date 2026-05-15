# Plan Review v1: 映射原因追踪 (Mapping Reason Tracking)

**评审模式**: 计划评审（Stage 5）
**日期**: 2026-05-15
**评审对象**: spec.md + plan.md + plan-backend.md + plan-frontend.md

---

## 评审总结

**结论**: 通过（0 条未解决问题，2 条 LOW）

---

## 1. Spec 完整性: ✅

- 目标明确：在请求详情面板展示映射原因 Badge
- 范围边界清楚：不新增 DB 列，不修改 API 接口签名
- AC1-AC6 覆盖 6 种映射原因，AC7-AC9 覆盖一致性和降级
- 数据流链路从 `resolveMapping()` 到前端 Badge 完整

## 2. Plan 可行性: ✅

- 后端 6 Task + 前端 5 Task，每个涉及 1-2 文件，职责单一
- 依赖关系正确：B1→B2/B3→B4→B5→B6，F1+F3 并行→F2→F4
- 最复杂的 Task B4（failover-loop.ts）拆为 4 个子步骤

## 3. 代码引用准确性: ✅

逐项验证：
- resolveMapping() 4 个返回路径（L76/L84/L121）与 plan 一致
- BP-H2 缓存结构（L187-188）与 plan 新增位置匹配
- StageRecord routing variant 签名与 plan 扩展字段一致
- OrchestratorConfig/buildActiveRequest（L18-31, L113-130）与 plan 匹配
- SSE strip 逻辑（L400-416）确认不会移除 mappingReason
- iterationSnapshot.add()（L297-298）准确定位

## 4. AC 覆盖验证: ✅

9 条 AC 全部有后端和前端 Task 对应覆盖。

## 5. 数据消费者完整性: ✅

12 个数据消费者（DB/SSE/Admin API/前端类型/转换器/展示/i18n）全覆盖。

## 6. 关键风险确认

| 风险 | 缓解状态 |
|------|---------|
| BP-H2 缓存丢失 mappingReason | ✅ Task B4 缓存扩展 |
| SSE request_start 无 mappingReason | ✅ 可接受，request_update 5s 轮询 |
| orchestrator.ts 传递时序 | ✅ currentReason 在 orchestrator.handle 调用前计算 |
| overflow 双记录策略 | ✅ 前端 parseMappingReason 优先级与后端一致 |

## 7. LOW 级建议

1. schedule 命中但 targets 解析失败退回 base 时，mappingReason 应为 `group_base_rule`（编码时注意）
2. 后端 RequestLog 类型缺少 pipeline_snapshot 字段（已有缺陷，非本次引入）

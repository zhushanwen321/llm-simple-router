# 编码评审 v1: 映射原因追踪

**评审日期**: 2026-05-15
**评审轮次**: v1
**评审范围**: 后端 B1-B6 + 前端 F1-F5

---

## 评审总结

**结论**: 通过（已修复）

### 已修复问题

1. `parseMappingReason` 数据格式不匹配 — 期望 `{ stages: [...] }` 但 DB 存储纯数组。已修复为 `Array.isArray(parsed) ? parsed : []`。
2. 后端 3 文件缩进警告（38 处）— 已通过 `lint --fix` 修复。

### Spec 合规: ✅

| AC | 状态 | 验证点 |
|----|------|--------|
| AC1 direct_format | ✅ | mapping-resolver.ts L135 |
| AC2 group_base_rule | ✅ | 默认值 + schedule 不命中不改写 |
| AC3 group_schedule | ✅ | schedule targets 非空时设置 |
| AC4 fallback_provider | ✅ | mapping-resolver.ts L148 |
| AC5 overflow_redirect | ✅ | failover-loop L280 覆写 + pipeline_snapshot 双记录 |
| AC6 failover_retry | ✅ | BP-H2 缓存路径硬编码 |
| AC7 双页面一致 | ✅ | fromLogEntry + fromActiveRequest 同源 |
| AC8 历史降级 | ✅ | optional 字段 + parseMappingReason 防御性解析 |
| AC9 DB 验证 | ✅ | 测试用例直接查询验证 |

### 架构合规: ✅

- 类型定义位置正确（core/types.ts）
- SSE strip 不影响 mappingReason
- 前端 shadcn-vue Badge、无 Emoji、无硬编码颜色
- template ~140 行 / script ~90 行

### 数据消费者: ✅

12 个消费点全部覆盖（DB/SSE/Admin API/前端类型/转换器/展示/i18n）。

### 验证结果

- 后端 1361 测试全部通过
- 后端 lint 0 警告
- 前端 vue-tsc 0 错误
- 前端 eslint 0 警告

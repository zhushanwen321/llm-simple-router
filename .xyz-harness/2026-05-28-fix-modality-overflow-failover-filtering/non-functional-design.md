---
verdict: pass
---

# Non-Functional Design — modality-overflow-failover-filtering

## 1. 稳定性

改动在 modality-redirect 预计算阶段内完成，该阶段在 failover 循环之前执行，不涉及运行时状态变更。异常安全机制保持不变（try-catch → 返回原始 targets），确保过滤逻辑出错时退化为旧行为而非阻断请求。唯一新增的"提前报错"路径（空列表）是幂等操作，重复调用结果一致。

## 2. 数据一致性

无 DB schema 变更。PipelineSnapshot.reason 字段新增 6 个枚举值，存储在 `request_logs.pipeline_snapshot` JSON 列中。JSON 列天然兼容新值，不需要迁移。现有 reason 值（如 `first-target-lacks-modality`）在旧日志中保持不变，新请求产生新 reason 值，不存在数据冲突。

## 3. 性能

过滤逻辑为 O(N×M)（N targets × M detected modalities），N 通常 ≤ 5，M ≤ 2（image/audio），实际开销 < 1ms。对比现有逻辑（已有 per-target provider lookup + parseModels），新增的 `Array.filter` 调用无额外 DB 查询开销（复用已有 provider 数据）。过滤减少 failover 迭代次数反而降低整体延迟。

## 4. 业务安全

不涉及。改动不改变 API 认证、密钥管理或用户权限逻辑。

## 5. 数据安全

不涉及。改动不引入新的敏感数据处理、文件操作或权限变更。错误 message 中包含 client_model 名称和检测到的模态类型，这些信息已在现有日志中记录，不构成新的信息泄露。

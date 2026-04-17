# Admin API 剩余策略

## validateRule 扩展

在 `src/admin/groups.ts` 的 `validateRule` 函数中，为三种新策略增加验证：

### round-robin / random

- rule 解析为 `{ targets: Target[] }`
- targets 必须是数组，至少 1 个元素
- 每个 target 必须有 backend_model 和 provider_id
- provider_id 对应的 provider 必须存在

### failover

- 同上，但 targets 至少 2 个元素
- 因为故障转移需要至少一个备选

## 无需新 migration

mapping_groups 表的 strategy 和 rule 字段已经是 TEXT，足够灵活。

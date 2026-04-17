# Admin API 剩余策略

## validateRule 扩展

在 `src/admin/groups.ts` 的 `validateRule` 函数中：

### 策略名白名单校验（优先）

首先检查 `strategy` 是否在 `STRATEGY_NAMES` 的值集合中，对未知策略名返回错误。

### round-robin / random

- rule 解析为 `{ targets: Target[] }`
- targets 必须是数组，至少 1 个元素
- 每个 target 必须有 backend_model 和 provider_id
- provider_id 对应的 provider 必须存在

### failover

- 同上，但 targets 至少 2 个元素

## 无需新 migration

mapping_groups 表的 strategy 和 rule 字段已经是 TEXT，足够灵活。

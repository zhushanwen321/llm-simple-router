# 数据模型

## Target 类型扩展

```typescript
interface Target {
  backend_model: string;
  provider_id: string;
  overflow_provider_id?: string;  // 溢出模型供应商
  overflow_model?: string;        // 溢出模型名称
}
```

溢出字段可选。未配置时，该 target 不启用溢出切换。

## 存储位置

存储在 `mapping_groups.rule` JSON 列中，与现有结构一致：

- **scheduled**: `{ default: Target, windows: [{start, end, target: Target}] }`
- **round-robin/random/failover**: `{ targets: Target[] }`

无需新增数据库表或迁移。前端编辑时将 overflow 字段一并写入 rule JSON。

## context_window 查找

使用已有的 `provider_model_info` 表（按 plan 重构后的独立表）+ `MODEL_CONTEXT_WINDOWS` 代码默认值。溢出模型下拉仅列出 `context_window >= 默认模型 context_window` 的模型。

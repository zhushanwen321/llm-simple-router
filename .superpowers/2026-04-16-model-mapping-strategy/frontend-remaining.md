# 前端 UI 剩余策略

## MappingGroupFormDialog.vue 改动

### 策略下拉

```
scheduled / round-robin / random / failover
```

### 按策略切换表单

- **scheduled**：保持现有 default + windows 表单
- **round-robin / random**：targets 列表（添加/删除 target，每项含 provider + model 选择）
- **failover**：有序 targets 列表（上下箭头排序 + 添加/删除）

### targets 列表组件

每个 target 项：
- Select: 供应商（数据来源：`api.getProviders()` 返回的 providers 列表）
- Select: 后端模型（联动供应商的 models 字段，数据来源：provider.models JSON 数组，已在 migration 012 中添加）
- 删除按钮

failover 额外：上移/下移按钮

## ModelMappings.vue 改动

分组列表展示按策略类型显示不同内容：
- scheduled：默认模型 + 时间窗口
- round-robin / random：targets 列表（模型名 + 供应商名）
- failover：有序 targets 列表（带序号）

## DEFAULT_FORM 调整

策略切换时重置表单结构：

```
scheduled → { default, windows }
round-robin / random / failover → { targets: [{backend_model, provider_id}] }
```

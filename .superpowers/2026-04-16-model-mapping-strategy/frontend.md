# 前端变更

路由不变，仍为 `/admin/mappings`。

## 页面结构

`ModelMappings.vue` 改为**分组卡片视图**。每个 `client_model` 是一个可展开的 `Card`（shadcn-vue）：

- **收起态**：显示 `client_model` 名称 + `strategy` Badge
- **展开态**：显示 rule 详情 + 添加/编辑/删除操作

## scheduled 策略编辑 UI

展开后分为两部分：

1. **默认模型行**：`backend_model`（Input）+ `provider`（Select）
2. **时间窗口列表**：每行包含 `start`（TimeInput）、`end`（TimeInput）、`target`（backend_model Input + provider Select），行尾有删除按钮；底部有"添加窗口"按钮

## 添加分组 Dialog

使用 `Dialog` 组件，字段：

- `client_model`（Input）
- `strategy`（Select，当前仅 `scheduled`）
- 默认 target 配置（backend_model + provider）

## 重试规则管理

在 Settings 页面（或独立 RetryRules 页面）新增：

- **规则表格**：每行显示 name、status_code、body_pattern、启用状态（Badge）
- **添加/编辑 Dialog**：name（Input）、status_code（Input, number）、body_pattern（Input, 带正则语法验证）
- **API 客户端**新增：`getRetryRules()`、`createRetryRule()`、`updateRetryRule()`、`deleteRetryRule()`

## API 客户端

`frontend/src/api/client.ts` 新增方法：

**mapping_groups**: `getMappingGroups()`、`createMappingGroup()`、`updateMappingGroup()`、`deleteMappingGroup()`
**retry_rules**: `getRetryRules()`、`createRetryRule()`、`updateRetryRule()`、`deleteRetryRule()`

## 组件规范

所有 UI 使用 shadcn-vue 组件，禁止原生 HTML 表单元素（Button、Input、Select、Card、Dialog、Badge 等），见项目 CLAUDE.md 规定。

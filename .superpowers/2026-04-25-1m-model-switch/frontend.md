# 前端改造

## 新组件：CascadingModelSelect

级联二层选择器，单个 input 展示 "供应商/模型"。

**交互：** 点击展开一级（供应商列表），hover 向右展开二级（模型列表，标注 context_window 大小如 "200K"、"1M"）。

**Props：** `providers`（带模型的供应商列表）、`model-value`（当前值 `{ provider_id, model }`）、`filterFn?`（过滤可选模型，溢出选择器用来限制 >= 默认模型窗口）。

## MappingGroupFormDialog 改造

每个 target card 从两个独立 Select 改为：
1. **默认模型** — CascadingModelSelect，标题显示 context_window（如 "200K模型"）
2. **1M 模型（可选）** — CascadingModelSelect + ? 圆圈 tooltip，仅列出 context_window >= 默认模型的选项
3. **绿色提示条** — 配置溢出后显示 "上下文超过 xxx 限制 (N K) 时自动切换到 yyy"

四种策略（scheduled/round-robin/random/failover）的 target 区域统一使用此布局。

## 移除的 UI

- `ContextCompact.vue` 整体删除
- `ProxyEnhancement.vue` 移除 "1M 上下文压缩" tab
- `ProxyEnhancementConfig` 类型中的 compact 相关字段

# 1M 上下文模型替换 — 设计规格

## 背景

原方案依赖 Claude Code 的 Reactive Compact 机制：router 返回 "prompt is too long" → Claude Code 触发 compact → router 重定向到 1M 模型。但 Reactive Compact 是 Anthropic 内部特性，外部构建无法使用。

新方案放弃 compact，改为**透明模型切换**：router 检测到上下文超过目标模型限制时，直接转发到配置的溢出模型，对客户端完全透明。

## 核心变化

| 维度 | 旧方案 | 新方案 |
|------|--------|--------|
| 触发方式 | 返回错误触发 compact | 直接切换模型转发 |
| 配置位置 | proxy-enhancement 全局设置 | 每个 target 独立配置 |
| 客户端感知 | 需要特殊错误码配合 | 完全透明 |
| 适用范围 | 仅 Claude Code | 所有客户端 |

## 子文档

- [数据模型](data-model.md) — Target 类型扩展与存储
- [前端改造](frontend.md) — 级联选择器与表单重构
- [后端改造](backend.md) — 溢出重定向逻辑
- [清理清单](cleanup.md) — 需要删除的旧代码

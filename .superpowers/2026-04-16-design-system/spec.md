# Design System 建设方案

## 背景

当前项目前端缺少业务层面的 design token（状态色、语义间距等），且没有机制防止样式漂移。
参考 stock-data-crawler 和 xyz-agent 两个项目的经验，建设分层 token 体系 + 强制执行机制。

## 决策

| 维度 | 决策 | 理由 |
|------|------|------|
| 色彩空间 | oklch | 保持 shadcn-vue reka-nova 默认，视觉均匀性更好 |
| 主题策略 | 双主题（light/dark class 切换） | 管理后台需要灵活切换 |
| 视觉风格 | 保留 neutral 无彩色系 | 与现有设计一致 |
| 架构方式 | 分层 token（tokens.css / components.css / design-tokens.ts） | 职责清晰，便于 ESLint 规则检查 |

## 详细设计

- [文件结构与分层架构](architecture.md)
- [Token 定义规范](tokens.md)
- [强制执行机制](enforcement.md)
- [迁移策略](migration.md)

## 不做的事

- 不升级 Tailwind 版本（保持 v3.4）
- 不替换 oklch 色彩空间
- 不更换 shadcn-vue 风格（保持 reka-nova）
- 不建立 typography token（保持 Tailwind 默认文字大小系统 + Geist 字体变量）
- 不影响后端代码

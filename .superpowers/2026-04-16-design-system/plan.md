# Design System 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建设分层 design token 体系 + ESLint 强制机制 + 全量迁移现有硬编码颜色

**Architecture:** 新增 tokens.css / components.css / design-tokens.ts 三文件分层管理业务 token，在 taste-lint 中添加 3 个 ESLint 规则强制 token 使用，最后批量迁移所有 views/components 中的硬编码颜色到 token 变量。

**Tech Stack:** Tailwind CSS v3.4 + oklch + shadcn-vue reka-nova + ESLint flat config

**Spec:** [spec.md](spec.md) | [tokens.md](tokens.md) | [enforcement.md](enforcement.md) | [migration.md](migration.md)

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| Create | `frontend/src/styles/tokens.css` | 业务 token（状态色/语义色/间距/阴影/动画/z-index） |
| Create | `frontend/src/styles/components.css` | @layer components 通用组件类 |
| Create | `frontend/src/styles/design-tokens.ts` | TypeScript 等价常量（Chart.js） |
| Modify | `frontend/src/style.css` | 添加 import 链 |
| Modify | `frontend/tailwind.config.js` | 注册新 token |
| Create | `taste-lint/rules/no-hardcoded-colors.mjs` | ESLint 规则：禁止硬编码颜色 |
| Create | `taste-lint/rules/no-magic-spacing.mjs` | ESLint 规则：禁止魔法间距 |
| Modify | `taste-lint/base.mjs` | 注册新规则 |
| Modify | `taste-lint/vue.mjs` | 引用新规则（scope 到 frontend/） |
| Modify | `.githooks/vue_rules_checker.py` | 添加硬编码颜色检查 |
| Create | `frontend/docs/design-system.md` | 设计规范文档 |
| Modify | 13 个 Vue/TS 文件 | 迁移硬编码颜色到 token |

## 任务索引

- [Phase 1: 基础设施](plan-1-infrastructure.md) — Tasks 1-5
- [Phase 2: ESLint 规则](plan-2-eslint-rules.md) — Tasks 6-9
- [Phase 3: 代码迁移](plan-3-migration.md) — Tasks 10-21
- [Phase 4: 文档与验证](plan-4-docs-verify.md) — Tasks 22-24

## 依赖关系

```
Phase 1 → Phase 2 → Phase 3 → Phase 4
```

Phase 1 和 Phase 2 的 ESLint 规则可以并行（token 文件不依赖 ESLint 规则），但 Phase 3 必须等 Phase 1+2 都完成。

## 注意事项

- **install-hooks.sh 无需修改** — 已包含完整的前端 ESLint 检查逻辑（含 `SKIP_FRONTEND_LINT` 环境变量支持），新增的 ESLint 规则会自动被现有 hook 触发。
- **语义色引用 shadcn 变量** — `--color-bg-page`、`--color-text-primary` 等通过 `var(--background)`、`var(--foreground)` 引用 shadcn-vue 已有变量，保持单一数据源。暗色模式自动跟随 shadcn 的 `.dark` 覆盖。

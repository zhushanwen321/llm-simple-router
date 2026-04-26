# 1M 上下文模型替换 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 compact 机制替换为透明溢出模型切换，每个 target 独立配置，对客户端完全透明。

**Architecture:** 扩展 Target 类型增加 overflow 字段。router 检测上下文超限时直接切换到溢出模型，不返回错误。前端新增级联选择器组件。

**Tech Stack:** TypeScript, Fastify, better-sqlite3, Vue 3, shadcn-vue

**前置依赖:** `provider_model_info` 表已存在（migration 023），`model-info.ts` 已实现。

---

## 任务总览

### Phase 1: 后端核心（[详细步骤](plan-p1.md)）

| 任务 | 描述 | 文件 |
|------|------|------|
| Task 1 | 扩展 Target 类型 | `strategy/types.ts`, `types/mapping.ts` |
| Task 2 | 创建溢出重定向逻辑 (TDD) | `proxy/overflow.ts`, `tests/overflow.test.ts` |
| Task 3 | 更新 proxy-handler | `proxy/proxy-handler.ts` |
| Task 4 | 重写集成测试 | `tests/context-compact.test.ts` → `tests/overflow-redirect.test.ts` |

### Phase 2: 后端清理（[详细步骤](plan-p2.md)）

| 任务 | 描述 | 文件 |
|------|------|------|
| Task 5 | 移除 compact 代码 | `enhancement-config.ts`, `proxy-enhancement.ts`, `compact-prompt.ts`, `compact.ts`, `model-context.ts` |

### Phase 3: 前端改造（[详细步骤](plan-p3.md)）

| 任务 | 描述 | 文件 |
|------|------|------|
| Task 6 | 创建 CascadingModelSelect 组件 | `components/mappings/CascadingModelSelect.vue` |
| Task 7 | 重构 MappingGroupFormDialog | `components/mappings/MappingGroupFormDialog.vue` |
| Task 8 | 前端清理 | `ContextCompact.vue`（删）, `ProxyEnhancement.vue`, `api/client.ts` |

---

## 执行约束

- 每个 Task 对应一次 subagent dispatch
- Phase 1 → Phase 2 串行（cleanup 依赖 core 完成）
- Phase 3 与 Phase 2 可并行
- 每个 subagent 修改 ≤5 文件，≤3000 行

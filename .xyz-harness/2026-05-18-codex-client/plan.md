---
verdict: pass
---

# Plan: 新增 Codex CLI 快速配置客户端

## Tasks

### Task 1: 前端类型 + i18n（3 文件）

**文件**: `frontend/src/components/quick-setup/types.ts`, `frontend/src/i18n/locales/zh-CN/quickSetup.json`, `frontend/src/i18n/locales/en/quickSetup.json`

1. `ClientType` 联合类型新增 `"codex"`
2. `CLIENTS` 数组在 `claude-code` 后插入 Codex 条目
3. `DEFAULT_CLIENT_MAPPINGS` 新增 `"codex"` 键
4. `QuickSetup.vue` 中 Codex 按钮的 iconClass `"cx"` 配色为 `bg-teal-600`
5. i18n 两个语言文件新增 `codex` / `codexDesc` 键

### Task 2: QuickSetup.vue 图标配色（1 文件）

**文件**: `frontend/src/views/QuickSetup.vue`

在 icon class 条件中新增 `'bg-teal-600 text-white': c.iconClass === 'cx'` 分支。

## 依赖关系

Task 1 和 Task 2 独立，可并行执行。

## 测试策略

- 选择 Codex 客户端 → apiType 切换为 openai-responses
- 映射区域显示 5 个模型
- 选择供应商后默认映射正确填充
- 中英文切换正常
- 保存配置成功

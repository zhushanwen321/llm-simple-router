# 强制执行机制

## ESLint 自定义规则

### 规则 1: no-hardcoded-colors

**目标：** Vue SFC `<template>` 中的 class 属性 + `<script>` 中的字符串

**禁止：**
- Tailwind 非语义色：`bg-red-500`、`text-blue-300`、`border-gray-200`
- 任意值颜色：`bg-[#ef4444]`、`text-[rgb(255,0,0)]`
- 内联 style 颜色：`style="color: red"`

**允许：**
- 语义色：`bg-destructive`、`text-success`、`border-border`
- shadcn-vue 语义色：`bg-background`、`text-foreground`、`text-muted-foreground`
- CSS 变量：`style="color: var(--color-danger)"`

**实现方式：** 正则匹配 class 值中的颜色相关 Tailwind 类名。排除 shadcn-vue 语义色（background/foreground/primary/secondary/muted/accent/destructive/card/popover/border/input/ring）和自定义 token（success/warning/danger/info）。

**`<script>` 中的颜色：** Chart.js 等场景需要在 TS 中使用颜色值，由 `design-tokens.ts` 常量约束，code review 时人工检查。

### 规则 2: no-magic-spacing

**目标：** Vue SFC `<template>` 中的 class 属性

**分阶段执行：**
- **Phase 1（当前）：** 只禁止任意值间距（如 `p-[17px]`），允许 Tailwind 标准 spacing scale（`p-4`、`gap-2`）
- **Phase 2（未来可选）：** 推广到完全语义 token（`p-page`、`gap-card`）

### 规则 3: no-native-form-elements

**目标：** Vue SFC `<template>`

**禁止：** `<button>`、`<input>`、`<select>`、`<textarea>`、`<label>`

**允许：** shadcn-vue 对应组件：`<Button>`、`<Input>`、`<Select>` 等

### 实现位置与作用范围

规则文件放在项目根目录 `taste-lint/` 下（与现有 `vue.mjs` 同级）。

每个规则必须设置 `files` pattern 限制为 `frontend/src/**`，避免影响后端代码。

在 `eslint.config.mjs` 中引用新规则，或考虑为前端建立独立的 `frontend/eslint.config.mjs`。

## Git pre-commit hook

项目已有 `.githooks/install-hooks.sh` 动态生成 `.git/hooks/pre-commit` 的机制。

在 `install-hooks.sh` 的生成脚本中新增检查段：

```bash
# 前端 design system 合规检查
if [ "$SKIP_FRONTEND_LINT" != "1" ]; then
  echo "→ Running frontend lint..."
  (cd frontend && npx eslint src/ --max-warnings=0) || exit 1
  echo "→ Running frontend type check..."
  (cd frontend && npx vue-tsc --noEmit) || exit 1
fi
```

**跳过方式：** `SKIP_FRONTEND_LINT=1 git commit -m "..."`

## 设计规范文档

位置：`frontend/docs/design-system.md`

包含：
- Token 清单和语义说明
- 颜色使用指南（什么时候用什么色）
- 间距规范
- 组件使用规范
- 暗色模式适配指南

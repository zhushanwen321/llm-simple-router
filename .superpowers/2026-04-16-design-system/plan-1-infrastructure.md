# Phase 1: 基础设施（Tasks 1-5）

## Task 1: 创建 tokens.css

**Files:**
- Create: `frontend/src/styles/tokens.css`

- [ ] **Step 1: 创建 styles 目录并编写 tokens.css**

内容严格按 [tokens.md](tokens.md) 定义编写。包含 `:root` 和 `.dark` 两套变量。

```css
/* === 状态色 === */
:root {
  --color-success: oklch(0.65 0.17 150);
  --color-success-light: oklch(0.92 0.05 150);
  --color-success-dark: oklch(0.45 0.15 150);
  --color-warning: oklch(0.78 0.16 80);
  --color-warning-light: oklch(0.94 0.06 80);
  --color-warning-dark: oklch(0.55 0.14 80);
  --color-danger: oklch(0.58 0.22 25);
  --color-danger-light: oklch(0.90 0.08 25);
  --color-danger-dark: oklch(0.40 0.18 25);
  --color-info: oklch(0.62 0.18 250);
  --color-info-light: oklch(0.91 0.06 250);
  --color-info-dark: oklch(0.43 0.16 250);

  /* === 语义色（引用 shadcn-vue 变量，保持单一数据源） === */
  --color-bg-page: var(--background);      /* 页面背景 = shadcn background */
  --color-bg-card: var(--card);            /* 卡片背景 = shadcn card */
  --color-bg-sidebar: oklch(0.205 0 0);   /* 侧边栏（shadcn 无对应变量） */
  --color-text-primary: var(--foreground); /* 主文本 = shadcn foreground */
  --color-text-secondary: var(--muted-foreground); /* 次要文本 = shadcn muted-foreground */
  --color-text-tertiary: oklch(0.65 0 0); /* 辅助文本（比 muted-foreground 更淡） */

  /* === 间距 === */
  --spacing-page: 1.5rem;
  --spacing-section: 1.25rem;
  --spacing-card: 1rem;
  --spacing-tight: 0.5rem;
  --gap-icon-text: 0.375rem;

  /* === 圆角 === */
  --radius-pill: 9999px;

  /* === 阴影 === */
  --shadow-card: 0 1px 3px oklch(0 0 0 / 0.1);
  --shadow-elevated: 0 4px 12px oklch(0 0 0 / 0.12);
  --shadow-focus: 0 0 0 2px oklch(0.62 0.18 250);

  /* === 动画 === */
  --duration-fast: 150ms;
  --duration-normal: 200ms;
  --ease-default: cubic-bezier(0.4, 0, 0.2, 1);

  /* === z-index === */
  --z-dropdown: 50;
  --z-modal: 100;
  --z-toast: 200;
}

.dark {
  --color-success-light: oklch(0.30 0.05 150);
  --color-warning-light: oklch(0.32 0.06 80);
  --color-danger-light: oklch(0.28 0.08 25);
  --color-info-light: oklch(0.28 0.06 250);

  /* 语义色通过 var() 引用 shadcn 变量，暗色模式自动跟随 shadcn .dark 覆盖 */
  /* --color-bg-page / --color-text-primary 等引用型变量无需额外覆盖 */

  --color-bg-sidebar: oklch(0.145 0 0);   /* 侧边栏暗色覆盖 */
  --color-text-tertiary: oklch(0.556 0 0); /* 辅助文本暗色覆盖 */
}
```

- [ ] **Step 2: 验证 CSS 语法**

Run: `cd frontend && npx tailwindcss --help`
确认 tokens.css 无语法错误。

## Task 2: 创建 components.css

**Files:**
- Create: `frontend/src/styles/components.css`

- [ ] **Step 1: 创建 components.css**

初始内容最小化，后续按需添加：

```css
@layer components {
  /* 通用组件类 — 按需扩展 */
}
```

## Task 3: 创建 design-tokens.ts

**Files:**
- Create: `frontend/src/styles/design-tokens.ts`

- [ ] **Step 1: 创建 design-tokens.ts**

内容按 [tokens.md](tokens.md) 的 TypeScript 等价常量编写：

```ts
/** Chart.js 等不支持 CSS 变量的场景使用的颜色常量 */
export const CHART_COLORS = {
  blue: 'oklch(0.62 0.18 250)',
  purple: 'oklch(0.55 0.2 290)',
  green: 'oklch(0.65 0.17 150)',
  amber: 'oklch(0.78 0.16 80)',
  blueFill: 'oklch(0.62 0.18 250 / 0.3)',
  purpleFill: 'oklch(0.55 0.2 290 / 0.3)',
  greenFill: 'oklch(0.65 0.17 150 / 0.3)',
  amberFill: 'oklch(0.78 0.16 80 / 0.1)',
  blueFillLight: 'oklch(0.62 0.18 250 / 0.1)',
} as const

/** 状态色映射（CSS 变量形式，用于动态样式） */
export const STATUS_COLORS = {
  success: { bg: 'var(--color-success-light)', text: 'var(--color-success-dark)' },
  danger: { bg: 'var(--color-danger-light)', text: 'var(--color-danger-dark)' },
  warning: { bg: 'var(--color-warning-light)', text: 'var(--color-warning-dark)' },
  info: { bg: 'var(--color-info-light)', text: 'var(--color-info-dark)' },
} as const
```

## Task 4: 更新 tailwind.config.js

**Files:**
- Modify: `frontend/tailwind.config.js`

- [ ] **Step 1: 在 theme.extend.colors 中添加新 token 映射**

在现有 `sidebar` 对象之后添加：

```js
success: {
  DEFAULT: 'var(--color-success)',
  light: 'var(--color-success-light)',
  dark: 'var(--color-success-dark)',
},
warning: {
  DEFAULT: 'var(--color-warning)',
  light: 'var(--color-warning-light)',
  dark: 'var(--color-warning-dark)',
},
danger: {
  DEFAULT: 'var(--color-danger)',
  light: 'var(--color-danger-light)',
  dark: 'var(--color-danger-dark)',
},
info: {
  DEFAULT: 'var(--color-info)',
  light: 'var(--color-info-light)',
  dark: 'var(--color-info-dark)',
},
page: 'var(--color-bg-page)',
```

- [ ] **Step 2: 添加 boxShadow 和 zIndex 扩展**

在 `fontFamily` 之后添加：

```js
boxShadow: {
  card: 'var(--shadow-card)',
  elevated: 'var(--shadow-elevated)',
  focus: 'var(--shadow-focus)',
},
zIndex: {
  dropdown: 'var(--z-dropdown)',
  modal: 'var(--z-modal)',
  toast: 'var(--z-toast)',
},
```

## Task 5: 更新 style.css import 链

**Files:**
- Modify: `frontend/src/style.css`

- [ ] **Step 1: 在现有 import 之后添加新 import**

在 `@import "shadcn-vue/tailwind.css";` 之后、`@tailwind base;` 之前插入：

```css
@import "./styles/tokens.css";
@import "./styles/components.css";
```

- [ ] **Step 2: 验证构建**

Run: `cd frontend && npm run build`
Expected: 构建成功，无 CSS 相关错误。

- [ ] **Step 3: 提交 Phase 1**

```bash
git add frontend/src/styles/ frontend/src/style.css frontend/tailwind.config.js
git commit -m "feat: add design token system with tokens.css, components.css, and design-tokens.ts"
```

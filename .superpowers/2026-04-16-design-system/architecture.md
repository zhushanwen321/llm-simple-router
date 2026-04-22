# 文件结构与分层架构

## 文件结构

```
frontend/src/
├── style.css                  # 入口：import shadcn 变量 + tokens + components
├── styles/
│   ├── tokens.css             # 纯 token 定义
│   ├── components.css         # @layer components 通用组件类
│   └── design-tokens.ts       # TypeScript 等价常量（Chart.js 等）
```

## 职责划分

| 文件 | 职责 |
|------|------|
| `style.css` | 保留 shadcn-vue oklch 基础变量 + import tokens 和 components |
| `tokens.css` | 业务 token：状态色、语义色、间距、圆角、阴影、动画、z-index |
| `components.css` | `@layer components` 通用类：`.card-base` 等 |
| `design-tokens.ts` | JS 等价常量：供 Chart.js、动态逻辑使用 |

## Import 链

新增的 import 插入在现有 import 之后、`@tailwind` 指令之前：

```css
/* style.css — 现有结构 */
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap');
@import "tw-animate-css";
@import "shadcn-vue/tailwind.css";

/* ↓ 新增 */
@import "./styles/tokens.css";
@import "./styles/components.css";

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root { /* 现有 shadcn-vue 变量保持不变 */ }
  .dark { /* 现有暗色变量保持不变 */ }
  /* ... 现有全局样式保持不变 ... */
}
```

## 命名规范

CSS 变量采用 `--category-variant` 模式：
- 颜色：`--color-success`、`--color-success-light`、`--color-success-dark`
- 间距：`--spacing-page`、`--spacing-section`、`--spacing-card`
- 阴影：`--shadow-card`、`--shadow-elevated`
- z-index：`--z-dropdown`、`--z-modal`、`--z-toast`

Tailwind 映射采用语义名：
- `bg-success`、`text-success-light`、`shadow-card`、`z-modal`

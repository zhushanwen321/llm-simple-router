# 组件与排版规范

## 1. 需新增的 shadcn-vue 组件

| 组件 | 用途 |
|------|------|
| `tooltip` | 表头说明、参数标签悬浮释义 |
| `separator` | 日志详情区块分隔 |
| `scroll-area` | SSE 事件流、JSON 预览的长内容滚动区域 |
| `avatar` | 消息列表的角色头像（user / assistant / system） |
| `switch` | 开关类配置项 |

安装命令：`cd frontend && npx shadcn-vue@latest add tooltip separator scroll-area avatar switch`

## 2. 自定义组件

| 组件 | 说明 |
|------|------|
| `MessageRow` | 消息摘要行：Avatar + 角色名 + 内容截断 + 时间戳，用于日志详情的消息列表 |
| `SseEventLine` | SSE 单行事件：事件类型标签 + 数据摘要 + 折叠展开，用于请求/响应流展示 |
| `TagPill` | 等宽小标签：用于工具名列表、content_type 标识等，基于 Badge 变体 |
| `StatPill` | 参数标签：model / stream / max_tokens 等键值对，固定 `font-mono text-xs` |
| `InfoBanner` | 信息横幅：带图标和背景色的卡片式标识（如 Claude Code 标识），基于 Card |

## 3. 排版 Token

### Mono 字体族

在 `style.css` 的 `:root` 新增，`tailwind.config.js` 的 `fontFamily` 同步扩展：

```css
--font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
```

```js
// tailwind.config.js → theme.extend.fontFamily
mono: ['var(--font-mono)'],
```

Google Fonts 引入（`style.css` 顶部）：
```css
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');
```

使用场景：`font-mono` 用于 JSON 预览、SSE 事件数据、code block、StatPill。

### 紧凑间距 Token

在 `tokens.css` 新增：

```css
/* 高密度布局（日志详情） */
--spacing-dense-xs: 0.25rem;   /* 4px — 最小间隙 */
--spacing-dense-sm: 0.375rem;  /* 6px — 行内间距 */
--spacing-dense-md: 0.5rem;    /* 8px — 区块间距 */
```

Tailwind 映射到 `spacing` 即可通过 `p-dense-xs` / `gap-dense-sm` 使用。

## 4. 与 tailwind.config.js 集成

所有新增 token 遵循已建立的 **CSS 变量 → Tailwind 引用** 模式：

- `tokens.css` 定义变量值（含 `.dark` 覆盖）
- `tailwind.config.js` 的 `theme.extend` 通过 `var(--xxx)` 引用
- 组件通过 Tailwind utility class 使用，不直接引用 CSS 变量

本次需在 `tailwind.config.js` 新增：

```js
fontFamily: {
  sans: ['var(--font-sans)'],
  heading: ['var(--font-heading)'],
  mono: ['var(--font-mono)'],  // 新增
},
spacing: {
  'dense-xs': 'var(--spacing-dense-xs)',  // 新增
  'dense-sm': 'var(--spacing-dense-sm)',
  'dense-md': 'var(--spacing-dense-md)',
},
```

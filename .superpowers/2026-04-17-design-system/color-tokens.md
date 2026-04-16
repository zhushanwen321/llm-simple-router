# 色彩 Token 规范

基于 oklch 色彩空间，hue 175 为 Teal 基调。

## 1. 品牌色（Teal）

hue 175，chroma 从低到高递增后递减，保持感知均匀。

```css
:root {
  --color-teal-50:  oklch(0.97 0.02 175);
  --color-teal-100: oklch(0.93 0.04 175);
  --color-teal-200: oklch(0.87 0.07 175);
  --color-teal-300: oklch(0.78 0.10 175);
  --color-teal-400: oklch(0.68 0.13 175);
  --color-teal-500: oklch(0.58 0.14 175);
  --color-teal-600: oklch(0.48 0.12 175);
  --color-teal-700: oklch(0.40 0.10 175);
  --color-teal-800: oklch(0.32 0.08 175);
  --color-teal-900: oklch(0.25 0.06 175);
}
```

`--color-teal-500` 为品牌主色，用于关键操作按钮、选中态高亮。
`--color-teal-100` 用于浅底背景，`--color-teal-700` 用于深色文字。

暗色模式下品牌色色阶通过降低明度适配，或由引用方自行选择合适的色阶。

## 2. 角色色

四种角色四种色相，最大化区分度：
- User: teal (hue 175) — 与品牌色一致
- Assistant: indigo (hue 260) — 冷色调辅助
- Tool: orange (hue 30) — 暖色调，代表外部工具
- Thinking: purple (hue 290) — 深邃，代表内部推理

```css
:root {
  --color-role-user:        oklch(0.78 0.10 175);
  --color-role-user-bg:     oklch(0.97 0.02 175);
  --color-role-assistant:   oklch(0.65 0.14 260);
  --color-role-assistant-bg:oklch(0.93 0.04 260);
  --color-role-tool:        oklch(0.65 0.14 30);
  --color-role-tool-bg:     oklch(0.94 0.04 30);
  --color-role-thinking:    oklch(0.58 0.12 290);
  --color-role-thinking-bg: oklch(0.91 0.03 290);
}

.dark {
  --color-role-user-bg:     oklch(0.28 0.04 175);
  --color-role-user:        oklch(0.72 0.08 175);
  --color-role-assistant-bg:oklch(0.25 0.05 260);
  --color-role-assistant:   oklch(0.60 0.10 260);
  --color-role-tool-bg:     oklch(0.25 0.05 30);
  --color-role-tool:        oklch(0.60 0.10 30);
  --color-role-thinking-bg: oklch(0.23 0.04 290);
  --color-role-thinking:    oklch(0.55 0.09 290);
}
```

命名：`--color-role-{role}` 文字/图标色，`--color-role-{role}-bg` 背景色。

## 3. SSE 事件色

用 teal 色族的不同明度区分事件阶段，stop 事件用 success 绿表示正常结束。

```css
:root {
  --color-sse-message-start:       oklch(0.68 0.13 175);
  --color-sse-content-block-start: oklch(0.58 0.14 175);
  --color-sse-content-block-delta: oklch(0.48 0.12 175);
  --color-sse-message-delta:       oklch(0.40 0.10 175);
  --color-sse-message-stop:        oklch(0.65 0.17 150);
}
```

从 start 到 delta 逐步加深，暗示「内容正在填充」；stop 用 success 绿表示正常结束。

暗色模式下 SSE 事件色需要下压明度（delta 系列从 L=0.48/0.40 降至 L=0.35/0.30）以避免在深色背景上过亮。

## 4. 待统一项

- `--shadow-focus` 当前使用 hue 250（蓝），应改为 teal（hue 175）与品牌色统一
- `design-tokens.ts` 中 CHART_COLORS 的 purple/blue 与角色色 hue 有重叠，保持两套独立：CHART_COLORS 服务图表，角色色服务日志 UI

## 5. 集成方式

将以上 token 追加到 `frontend/src/styles/tokens.css`：

- 品牌色色阶放在 `:root` 顶部（状态色之前），供全局引用
- 角色色和 SSE 事件色放在状态色之后、语义色之前
- `.dark` 块中追加角色色的暗色模式覆盖
- SSE 事件色在暗色模式下暂不调整（深色已够用），后续可按需补充

引用方式：组件中直接 `var(--color-role-user-bg)` 或 Tailwind 配置中映射为 `bg-role-user` 等工具类。

# Design System v2 — 设计规格

## 背景

当前管理后台使用 shadcn-vue 默认 neutral 灰阶主题，缺乏品牌识别度和语义色彩编码。基于日志详情页 mockup 的设计方向，对全站 design system 进行重塑。

## 已确认决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 品牌色 | Teal（青色） | 独特识别度，与 AI 工具定位契合 |
| 角色色 | 四色相方案 | User=teal(175), Assistant=indigo(260), Tool=orange(30), Thinking=purple(290)，最大化区分度 |
| 组件策略 | shadcn-vue 优先 | 一致性、可维护性 |
| 暗色模式 | 同步支持 | oklch 色彩空间便于明度调整 |
| 色彩空间 | oklch | 保持现有体系不变 |

## 子文档

- [色彩 Token 规范](./color-tokens.md) — 品牌色、角色色、SSE 事件色的 oklch 定义
- [组件与排版规范](./components-typography.md) — 新增组件、排版 token、集成方式

## 影响范围

### 需修改的文件
- `frontend/src/styles/tokens.css` — 新增品牌色、角色色、SSE 事件色 token
- `frontend/src/style.css` — 调整 shadcn 基础色变量（primary/muted 等）引入 teal
- `frontend/tailwind.config.js` — 新增 color token 映射
- `frontend/docs/design-system.md` — 更新文档

### 需修改的文件（续）
- `frontend/src/styles/design-tokens.ts` — 扩展角色色/SSE 色常量

### 不受影响
- shadcn-vue 组件源码（`components/ui/`）— 不修改
- 现有页面组件（`views/`）— 后续按新 token 逐步迁移

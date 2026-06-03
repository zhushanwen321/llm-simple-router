# 暗色主题支持 — 设计文档

## 概述

为 LLM Simple Router 管理后台添加暗色主题支持，采用亮/暗双档切换，覆盖全部页面。

## 设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 切换模式 | 亮/暗双档 | 简洁直观，避免三档困惑 |
| 视觉风格 | 沿用 shadcn dark 色板 | 已精心调好，覆盖全面 |
| 持久化 | localStorage | 纯前端体验，与设备环境相关 |
| 切换交互 | Sidebar 底部图标按钮（Moon/Sun） | 简洁紧凑，一目了然 |
| Chart.js | MutationObserver 监听 html class 变化 | 最可靠，主题变化时动态更新图表配色 |
| 实施范围 | 全量页面验证 | 一次到位，避免用户发现残缺暗色 |

## 实现方案

### 1. 主题切换机制

新建 `composables/useTheme.ts`：

- 状态：`'light' | 'dark'`
- localStorage key：`llm-router-theme`
- 初始化：读取 localStorage，无值默认 `'light'`
- 切换：更新 localStorage + 在 `<html>` 上添加/移除 `.dark` class
- 暴露 `isDark` boolean 和 `toggleTheme()` 方法

Sidebar 底部添加图标按钮：
- 亮色时显示 Moon 图标，暗色时显示 Sun 图标
- 点击即切换

### 2. Chart.js 暗色适配

- 使用 `MutationObserver` 监听 `<html>` 的 class 变化
- 暗色模式调整：网格线颜色、tick 文字颜色、图例文字颜色
- 折线颜色不变（Teal 在两种背景下均可见）
- 在 `useDashboard` 和 Monitor 中使用

### 3. 全量页面验证

核心原则：所有颜色使用 Tailwind 语义 class（`text-foreground`、`bg-card`、`border-border`），不硬编码。

逐页检查并修复硬编码颜色。

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `composables/useTheme.ts` | 主题切换 composable |
| 修改 | `components/layout/Sidebar.vue` | 底部添加主题切换按钮 |
| 修改 | `composables/useDashboard.ts` | 图表监听主题变化 |
| 修改 | `views/metrics-helpers.ts` | Chart.js 配置支持暗色参数 |
| 修改 | 所有 views 页面 | 修复硬编码颜色 |

## 实施顺序

1. 建 `useTheme.ts` + Sidebar 按钮 → 主题可切换
2. 逐页扫描硬编码颜色并修复 → 全量暗色适配
3. 处理 Chart.js 动态更新 → 图表暗色适配

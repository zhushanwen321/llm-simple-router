# 升级通知与一键升级功能设计

## 概述

在管理后台 Sidebar 版本号旁显示更新通知 badge，点击弹出面板展示 npm 新版本和推荐配置更新，支持一键升级/同步。

## 需求决策

| 决策项 | 结论 |
|--------|------|
| UI 方案 | Sidebar 版本 badge 红点 + Popover 弹出面板 |
| npm 版本来源 | npm registry API |
| 推荐配置来源 | GitHub/Gitee 远程 JSON 对比，用户自选并记住偏好 |
| 检测频率 | 后端每小时定时检查 |
| 部署方式 | 自动检测 npm/Docker/Podman |
| npm 升级 | 支持一键升级，完成后弹框选择是否重启 |
| Docker/Podman | 仅显示提示和 docker pull 命令 |
| 配置同步 | 一键同步，Select 下拉选来源，选择后存 DB 记住 |

## 后端设计

### 定时检查服务 `src/upgrade/checker.ts`

启动时创建 setInterval（每小时），执行：

**npm 版本检查**：
- GET `https://registry.npmjs.org/llm-simple-router`，取 `dist-tags.latest`
- 当前版本从 package.json 读取（readFileSync）
- 结果缓存到模块变量

**推荐配置检查**：
- 从用户选择的来源 raw URL 拉取 `recommended-providers.json` 和 `recommended-retry-rules.json`
- GitHub: `https://raw.githubusercontent.com/zhushanwen321/llm-simple-router/main/config/{file}`
- Gitee: `https://gitee.com/zzzzswszzzz/llm-simple-router/raw/main/config/{file}`
- 与本地 config/ 文件 JSON 序列化后对比
- 结果缓存到模块变量

**失败策略**：静默跳过，下次定时器继续。

### 部署检测 `src/upgrade/deployment.ts`

- 检测 `/.dockerenv` 或 `/run/.containerenv` → Docker/Podman
- 否则检测 npm 命令可用性 → npm 全局安装
- 返回 `'npm' | 'docker' | 'unknown'`

### API 端点 `src/admin/upgrade.ts`

| 端点 | 方法 | 功能 |
|------|------|------|
| `/admin/api/upgrade/status` | GET | 检查结果 + 部署方式 + 同步来源偏好 |
| `/admin/api/upgrade/check` | POST | 手动触发立即检查 |
| `/admin/api/upgrade/execute` | POST | 执行 `npm install -g llm-simple-router@{version}` |
| `/admin/api/upgrade/sync-config` | POST | 拉取远程 JSON 写入 config/ + reloadConfig() |

**持久化**：settings 表新增 key `config_sync_source`，值为 `'github'` 或 `'gitee'`。

## 前端设计

### Sidebar 通知 Badge

版本号 Badge 旁加红色小圆点，数字为更新项数量（npm 有更新算 1 + 配置有更新算 1）。无更新时隐藏。

### Popover 弹出面板

两个卡片区域：

**版本升级卡片**：
- npm 模式：显示当前→最新版本 + 「一键升级」按钮
- Docker 模式：显示提示 + docker pull 命令

**配置同步卡片**：
- 显示变更概要（新增/更新的供应商和规则数量）
- Select 下拉选来源（GitHub/Gitee），选择后自动保存偏好到后端
- 「同步配置」按钮

底部：上次检查时间 + 「立即检查」链接。

### 交互流程

1. 点击「一键升级」→ AlertDialog 确认（显示命令 + 风险提示）
2. 确认后执行 → 成功 → AlertDialog 选择「稍后重启」/「立即重启」
3. 点击「同步配置」→ 直接执行 → toast 成功/失败提示

## 错误处理

| 场景 | 处理 |
|------|------|
| npm registry 不可达 | 静默跳过，不显示更新 |
| 升级执行失败 | toast.error 显示错误 |
| 配置同步失败 | toast.error，不修改本地文件 |
| 检查超时 | 5s 超时控制 |

## 文件变更清单

| 文件 | 操作 |
|------|------|
| `src/upgrade/checker.ts` | 新增 |
| `src/upgrade/deployment.ts` | 新增 |
| `src/admin/upgrade.ts` | 新增 |
| `src/index.ts` | 修改：注册定时检查 |
| `src/admin/routes.ts` | 修改：注册 upgrade 路由 |
| `src/db/settings.ts` | 修改：新增 config_sync_source 读写 |
| `frontend/src/components/layout/Sidebar.vue` | 修改：badge + Popover |
| `frontend/src/api/client.ts` | 修改：新增 upgrade API |

# 插件化架构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 LLM Router 构建统一插件系统，支持通过 Git 仓库地址动态安装插件，覆盖代理增强和日志解析两个扩展点。

**Architecture:** 后端 Plugin Engine 管理插件生命周期（install/enable/disable/uninstall），在代理流程中注入 Hook 调用；前端 PluginRegistry 管理日志解析插件，通过动态 import 加载远程插件入口。内置插件 `claude-code-enhancer` 和 `sse-log-parser` 提供向后兼容的默认行为。

**Tech Stack:** Fastify + better-sqlite3 (后端), Vue 3 + shadcn-vue + Vite (前端), TypeScript

---

## File Structure

### 后端新文件

| 文件 | 职责 |
|------|------|
| `src/plugins/types.ts` | 插件接口类型定义（ServerPluginModule、ClientPluginModule、Manifest 等） |
| `src/plugins/engine.ts` | PluginEngine 核心类：加载、卸载、Hook 执行 |
| `src/plugins/manager.ts` | 插件管理：install（git clone + npm i）、enable/disable/uninstall |
| `src/plugins/internal/claude-code-enhancer.ts` | 内置代理增强插件（从 enhancement-handler 迁移） |
| `src/plugins/internal/sse-log-parser.ts` | 内置 SSE 日志解析插件（从 useSSEParsing 迁移，后端部分） |
| `src/admin/plugins.ts` | Admin API：plugins CRUD、client-assets 静态文件服务 |
| `src/db/migrations/015_add_plugins_table.sql` | 创建 plugins 表的 DB 迁移 |

### 后端修改文件

| 文件 | 改动 |
|------|------|
| `src/db/index.ts` | 添加插件相关 DB 查询函数（listPlugins、getPlugin、insertPlugin、updatePluginStatus 等） |
| `src/proxy/proxy-core.ts` | 在 handleProxyPost 中嵌入 pluginEngine.runBeforeProxy/intercept/afterResponse |
| `src/index.ts` | 创建 PluginEngine 实例，注册 admin plugins 路由，启动时 restorePlugins |
| `src/admin/routes.ts` | 注册 plugins admin routes |

### 前端新文件

| 文件 | 职责 |
|------|------|
| `frontend/src/components/log-viewer/PluginRegistry.ts` | 前端插件注册中心：动态加载、优先级匹配 |
| `frontend/src/components/log-viewer/BuiltInSseParser.ts` | 内置 SSE 解析插件的前端实现 |
| `frontend/src/views/Plugins.vue` | 插件管理页面（安装、启用、禁用、卸载） |

### 前端修改文件

| 文件 | 改动 |
|------|------|
| `frontend/src/components/log-viewer/LogResponseViewer.vue` | 通过 PluginRegistry 获取解析器和渲染组件 |
| `frontend/src/components/log-viewer/LogRequestViewer.vue` | 通过 PluginRegistry 获取请求解析器 |
| `frontend/src/router/index.ts` | 添加 `/admin/plugins` 路由 |
| `frontend/src/api/client.ts` | 添加插件相关 API 调用 |

### 测试

| 文件 | 职责 |
|------|------|
| `tests/plugins.test.ts` | Plugin Engine 单元测试 |
| `tests/admin-plugins.test.ts` | Admin API 集成测试 |

---

## 实施阶段

| 阶段 | 范围 | 计划文件 |
|------|------|----------|
| P0 | Plugin Engine 核心 + DB 表 + Admin API | [plan-p0-p1.md](plan-p0-p1.md) |
| P1 | enhancement-handler → 内置代理增强插件 | [plan-p0-p1.md](plan-p0-p1.md) |
| P2 | 前端插件加载 + useSSEParsing → 内置插件 | [plan-p2-p3.md](plan-p2-p3.md) |
| P3 | Plugins 管理页面 UI | [plan-p2-p3.md](plan-p2-p3.md) |
| P4 | 示例插件模板 + 开发文档 | [plan-p4.md](plan-p4.md) |

P0-P1 先完成，P2-P3 随后，P4 收尾。

---
title: 插件化架构设计
date: 2026-04-18
status: approved
---

# 插件化架构设计

## 背景

当前代理增强（enhancement-handler）和日志解析（useSSEParsing）逻辑硬编码在项目中。
需要插件化架构，使用户通过填写 Git 仓库地址即可安装和使用第三方插件。

## 设计目标

- 统一插件包（前后端代码在一个仓库）
- 动态远程加载（用户填 Git 仓库地址，系统自动拉取安装）
- 第一阶段无沙箱，设计预留沙箱接口
- 分阶段实现

## 扩展点

| 扩展点 | 运行位置 | 触发时机 |
|--------|---------|---------|
| `proxy:beforeProxy` | 后端 | 代理转发前，修改请求 |
| `proxy:afterResponse` | 后端 | 上游响应返回后，修改响应 |
| `proxy:intercept` | 后端 | 替代转发，返回自定义响应 |
| `log:parseRequest` | 前端 | 日志详情页，解析请求体 |
| `log:parseResponse` | 前端 | 日志详情页，解析响应体 |
| `log:renderComponent` | 前端 | 结构化展示，自定义 Vue 组件 |

## 生命周期

```
register(仓库地址) → install(git clone + npm i) → enable(加载到内存)
→ disable(从内存卸载) → uninstall(删除文件)
```

## 详细设计

- [接口规范](interfaces.md) — Manifest、后端/前端插件接口
- [核心机制](engine.md) — Plugin Engine、Hook 执行、数据库表
- [管理界面](admin-ui.md) — Admin API、前端管理页面、日志查看器改造
- [错误处理与实施](error-and-phases.md) — 错误策略、分阶段计划

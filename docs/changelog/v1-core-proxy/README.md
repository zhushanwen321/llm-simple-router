# v1: Core Proxy (v0.3~v0.5)

> 2026-04-14 ~ 2026-04-27

## 概要

项目初始阶段。完成核心代理转发、Provider CRUD、密钥认证、SQLite 存储等基础功能。

## 关键里程碑

- v0.3.0 — 核心 HTTP 代理转发 + SSE 流式支持
- v0.4.0 — 管理后台 MVP（Provider/映射/密钥页面）
- v0.5.0 — Provider 连接测试 + 并发控制

## 目录内容

| 文件 | 说明 |
|------|------|
| `architecture/request-pipeline.md` | 请求处理流水线 |
| `architecture/system-context.md` | 系统上下文图 |
| `architecture/architecture-review.md` | 架构审查记录 |
| `screenshot/` | 早期 UI 截图 (dashboard, provider) |

## 设计决策

见 `adr/0002-native-http-request-for-proxy.md`、`adr/0003-four-layer-proxy-architecture.md`、`adr/0004-sqlite-as-sole-storage.md`

# LLM Simple Router - 阶段1实施计划：核心代理

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 LLM API 透传路由器的核心代理功能，支持 OpenAI 和 Anthropic 两种协议的请求转发。

**Architecture:** Fastify 服务器接收客户端请求，通过认证中间件验证 API Key，根据请求路径匹配 API 类型，查找后端服务并透传请求（含 SSE 流式），同时支持模型名映射和请求日志记录。

**Tech Stack:** Node.js 20, TypeScript, Fastify 5, better-sqlite3, AES-256-GCM (Node crypto)

**Spec:** `docs/superpowers/specs/2026-04-14-llm-api-router-design.md`

---

## 文件结构

```
src/
├── index.ts              # Fastify 服务器入口
├── config.ts             # 环境变量解析与配置类型
├── db/
│   ├── index.ts          # SQLite 连接 + 查询封装
│   └── migrations/
│       └── 001_init.sql  # 初始建表 SQL
├── proxy/
│   ├── openai.ts         # /v1/chat/completions + /v1/models 代理
│   └── anthropic.ts      # /v1/messages 代理
├── middleware/
│   └── auth.ts           # Bearer Token 认证
└── utils/
    ├── logger.ts         # 基于 pino 的日志
    └── crypto.ts         # AES-256-GCM 加解密

tests/
├── helper.ts             # 测试工具（内存 DB、mock 服务）
├── config.test.ts
├── crypto.test.ts
├── db.test.ts
├── auth.test.ts
├── openai-proxy.test.ts
└── anthropic-proxy.test.ts
```

## 任务列表

| Task | 内容 | 子文档 |
|------|------|--------|
| 1 | 项目脚手架 + 配置 | [tasks-1-3.md](tasks-1-3.md) |
| 2 | SQLite + 加密工具 | [tasks-1-3.md](tasks-1-3.md) |
| 3 | 认证中间件 | [tasks-1-3.md](tasks-1-3.md) |
| 4 | OpenAI 代理（SSE + 模型映射） | [tasks-4-5.md](tasks-4-5.md) |
| 5 | Anthropic 代理（SSE + 模型映射） | [tasks-4-5.md](tasks-4-5.md) |
| 6 | /v1/models 代理 + 请求日志 | [tasks-6-8.md](tasks-6-8.md) |
| 7 | 集成测试 | [tasks-6-8.md](tasks-6-8.md) |
| 8 | Docker 构建配置 | [tasks-6-8.md](tasks-6-8.md) |

## 依赖关系

```
Task 1 → Task 2 → Task 3 → Task 4 → Task 6
                             Task 5 → Task 6
                                      Task 6 → Task 7 → Task 8
```

Task 4 和 Task 5 可并行执行。

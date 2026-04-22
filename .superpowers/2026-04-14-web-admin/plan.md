# Web 管理界面实施计划（阶段 2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 LLM Simple Router 添加 Web 管理界面，包括管理 REST API 和 Vue 3 SPA 前端。

**Architecture:** Fastify 后端提供 `/admin/api/*` REST API（JWT 认证），Vue 3 SPA 构建为静态文件由 `@fastify/static` 在 `/admin/` 下提供服务。前端使用 shadcn-vue 组件库。

**Tech Stack:** Fastify 5, TypeScript, jsonwebtoken, Vue 3, Vite, Tailwind CSS v3, shadcn-vue, Vue Router, recharts

**Spec:** `docs/superpowers/specs/2026-04-14-llm-api-router-design.md`

---

## 文件结构

### 后端新增/修改

```
src/
├── admin/
│   ├── routes.ts          # 管理 API 路由注册
│   ├── services.ts        # 后端服务 CRUD 逻辑
│   ├── mappings.ts        # 模型映射 CRUD 逻辑
│   ├── logs.ts            # 日志查询与清理
│   └── stats.ts           # 统计概览
├── middleware/
│   └── admin-auth.ts      # JWT 认证中间件
├── index.ts               # 注册 admin 路由 + 静态文件服务
```

### 前端新增

```
frontend/
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── components.json        # shadcn-vue 配置
├── src/
│   ├── main.ts
│   ├── App.vue
│   ├── api/
│   │   └── client.ts      # axios 封装 + JWT 拦截器
│   ├── router/
│   │   └── index.ts
│   ├── views/
│   │   ├── Login.vue
│   │   ├── Dashboard.vue
│   │   ├── Services.vue
│   │   ├── ModelMappings.vue
│   │   └── Logs.vue
│   ├── components/
│   │   └── layout/        # Sidebar, Header 等
│   └── lib/
│       └── utils.ts       # shadcn-vue 工具函数
```

## 任务列表

| Task | 内容 | 子文档 |
|------|------|--------|
| 1 | 管理 API: JWT 认证 + 服务 CRUD | [tasks-1-2.md](tasks-1-2.md) |
| 2 | 管理 API: 映射 CRUD + 日志 + 统计 | [tasks-1-2.md](tasks-1-2.md) |
| 3 | Vue 3 前端初始化 + 登录页 | [tasks-3-4.md](tasks-3-4.md) |
| 4 | 管理页面（Services + Mappings + Logs + Dashboard） | [tasks-3-4.md](tasks-3-4.md) |
| 5 | 集成 + Docker 多阶段构建更新 | [tasks-5.md](tasks-5.md) |

## 依赖关系

```
Task 1 → Task 2 → Task 3 → Task 4 → Task 5
```

串行执行，每个 Task 依赖前一个完成。

## 已有接口参考

### 数据库查询函数（src/db/index.ts）

```typescript
getActiveBackendServices(db, apiType): BackendService[]
getModelMapping(db, clientModel): ModelMapping | undefined
insertRequestLog(db, log): void
// 还需新增：
getAllBackendServices(db): BackendService[]
getBackendServiceById(db, id): BackendService | undefined
createBackendService(db, service): void
updateBackendService(db, id, service): void
deleteBackendService(db, id): void
getAllModelMappings(db): ModelMapping[]
createModelMapping(db, mapping): void
updateModelMapping(db, id, mapping): void
deleteModelMapping(db, id): void
getRequestLogs(db, options): RequestLog[]
deleteLogsBefore(db, beforeDate): void
getStats(db): Stats
```

### 加密工具（src/utils/crypto.ts）

```typescript
encrypt(text: string, key: string): string
decrypt(encrypted: string, key: string): string
```

### 配置（src/config.ts）

```typescript
getConfig(): Config  // 包含 ADMIN_PASSWORD, ENCRYPTION_KEY 等
```

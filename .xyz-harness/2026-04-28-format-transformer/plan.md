# Format Transformer 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 OpenAI / Anthropic 格式互转，解除入口格式与 Provider api_type 的绑定

**Architecture:** Adapter 模式直接双向转换，位于 Handler 层。新增 `src/proxy/transform/` 目录包含纯函数转换器和 Transform 流。Plugin 系统提供 Provider 级个性化能力。

**Tech Stack:** TypeScript, Node.js Transform streams, better-sqlite3, Fastify

**Specs:**
- [spec.md](./spec.md) — 设计决策总览
- [spec-request.md](./spec-request.md) — 请求转换规格
- [spec-response.md](./spec-response.md) — 响应转换规格
- [spec-plugin.md](./spec-plugin.md) — 插件系统规格

---

## Phase 1: 核心转换能力

> 纯函数转换器 + 流式 Transform 流。无插件、无 Admin。完成后跨格式代理可用。

详见 [plan-phase1.md](./plan-phase1.md)

### Task 概览

| Task | 内容 | 依赖 |
|------|------|------|
| T1 | 类型定义 `types.ts` | 无 |
| T2 | Stop reason 映射 `usage-mapper.ts` | T1 |
| T3 | Usage 映射 `usage-mapper.ts` | T1 |
| T4 | Tool 映射 `tool-mapper.ts` | T1 |
| T5 | Thinking 映射 `thinking-mapper.ts` | T1 |
| T6 | 消息归一化 + 交替强制 `message-mapper.ts` | T1 |
| T7 | 请求转换 `request-transform.ts` | T2-T6 |
| T8 | 非流式响应转换 `response-transform.ts` | T2-T6 |
| T9 | SafeSSEParser | 无 |
| T10 | FormatStreamTransform 基类 + OA→Ant | T1,T9 |
| T11 | Ant→OA 流式转换 | T1,T9 |
| T12 | TransformCoordinator | T7,T8,T10,T11 |
| T13 | 集成到 proxy-handler + stream-proxy | T12 |

---

## Phase 2: 集成测试

> 端到端测试：4 种场景 × 流式/非流式 × 正常/错误

详见 [plan-phase2.md](./plan-phase2.md)

| Task | 内容 | 依赖 |
|------|------|------|
| T14 | OA→OA 直通集成测试 | Phase 1 |
| T15 | Ant→Ant 直通集成测试 | Phase 1 |
| T16 | OA→Ant 非流式集成测试 | Phase 1 |
| T17 | OA→Ant 流式集成测试 | Phase 1 |
| T18 | Ant→OA 非流式集成测试 | Phase 1 |
| T19 | Ant→OA 流式集成测试 | Phase 1 |
| T20 | 错误场景集成测试 | Phase 1 |

---

## Phase 3: 插件系统

> DB 存储 + 内存缓存 + 插件注册表 + 热重载

详见 [plan-phase3.md](./plan-phase3.md)

| Task | 内容 | 依赖 |
|------|------|------|
| T21 | DB migration + transform-rules CRUD | Phase 2 |
| T22 | Plugin 接口 + 注册表 | Phase 2 |
| T23 | 声明式规则 → Plugin 转换 | T21,T22 |
| T24 | 文件插件扫描 | T22 |
| T25 | 热重载 + 缓存刷新 | T21-T24 |
| T26 | 插件系统集成测试 | T25 |

---

## Phase 4: Admin API + UI

> CRUD 端点 + Provider 编辑页折叠面板 + 重载按钮

详见 [plan-phase4.md](./plan-phase4.md)

| Task | 内容 | 依赖 |
|------|------|------|
| T27 | Admin API 端点 | Phase 3 |
| T28 | Admin API 测试 | T27 |
| T29 | 前端 API client 方法 | T27 |
| T30 | Provider 页面转换规则面板 | T29 |
| T31 | 重载按钮 | T29 |

---

## Phase 5: 清理

| Task | 内容 | 依赖 |
|------|------|------|
| T32 | openai.ts 移除旧 stream_options 注入 | Phase 4 |
| T33 | 全量 lint + test 通过 | Phase 4 |
| T34 | README 更新 | Phase 4 |

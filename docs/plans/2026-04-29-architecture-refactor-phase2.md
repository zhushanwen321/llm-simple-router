# Phase 2: proxy/ 子目录拆分 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** 将 proxy/ 下 18 个平铺文件按职责归入 transport/, orchestration/, routing/, handler/ 四个子目录。

**Architecture:** 纯文件移动 + import 路径批量替换。零逻辑变更。

**Tech Stack:** TypeScript, Vitest

**前提:** Phase 1 已完成，所有测试通过。

---

## File Structure

### 移动文件（4 组）

**组 1: proxy/transport/（出站适配 — 上游 HTTP 传输）**
- `proxy/transport.ts` → `proxy/transport/http.ts`
- `proxy/stream-proxy.ts` → `proxy/transport/stream.ts`
- `proxy/transport-fn.ts` → `proxy/transport/transport-fn.ts`
- 从 `proxy/proxy-core.ts` 抽出 `buildUpstreamHeaders`, `buildUpstreamUrl` → `proxy/transport/headers.ts`

**组 2: proxy/orchestration/（编排层 — 信号量 + 重试 + 追踪）**
- `proxy/orchestrator.ts` → `proxy/orchestration/orchestrator.ts`
- `proxy/resilience.ts` → `proxy/orchestration/resilience.ts`
- `proxy/semaphore.ts` → `proxy/orchestration/semaphore.ts`
- `proxy/scope.ts` → `proxy/orchestration/scope.ts`
- `proxy/retry-rules.ts` → `proxy/orchestration/retry-rules.ts`

**组 3: proxy/routing/（路由/映射）**
- `proxy/mapping-resolver.ts` → `proxy/routing/mapping-resolver.ts`
- `proxy/model-state.ts` → `proxy/routing/model-state.ts`
- `proxy/overflow.ts` → `proxy/routing/overflow.ts`
- `proxy/usage-window-tracker.ts` → `proxy/routing/usage-window-tracker.ts`
- `proxy/enhancement-config.ts` → `proxy/routing/enhancement-config.ts`

**组 4: proxy/handler/（请求处理 — 从大文件拆出）**
- 从 `proxy/proxy-core.ts` 抽出 `createErrorFormatter`, `ErrorKind`, `ProxyErrorResponse` → `proxy/handler/error-formatter.ts`
- 从 `proxy/proxy-logging.ts` 抽出 `handleIntercept`, `sanitizeHeadersForLog`, `logResilienceResult`, `collectTransportMetrics` → `proxy/handler/log-writer.ts`
- 合并 `proxy/log-helpers.ts` → `proxy/handler/log-writer.ts`
- `proxy/proxy-core.ts` 的 `proxyGetRequest` 移入 `proxy/transport/http.ts`

### 删除文件（拆分完成后）
- `proxy/proxy-core.ts` — 已拆到 handler/ + transport/
- `proxy/proxy-logging.ts` — 已拆到 handler/
- `proxy/log-helpers.ts` — 已合并到 handler/log-writer.ts

---

## Task 1: 移动 transport 组

移动 3 个文件到 proxy/transport/，不拆分 proxy-core.ts（保持 headers 暂留原位）。

- [ ] **Step 1:** 创建目录，移动文件
- [ ] **Step 2:** 更新 proxy 内部引用（~15 个文件）
- [ ] **Step 3:** 更新 proxy 外部引用（metrics/）
- [ ] **Step 4:** 验证 + commit

## Task 2: 移动 orchestration 组

移动 5 个文件到 proxy/orchestration/。

- [ ] **Step 1:** 创建目录，移动文件
- [ ] **Step 2:** 更新 proxy 内部引用
- [ ] **Step 3:** 更新 proxy 外部引用（index.ts）
- [ ] **Step 4:** 验证 + commit

## Task 3: 移动 routing 组

移动 5 个文件到 proxy/routing/。

- [ ] **Step 1:** 创建目录，移动文件
- [ ] **Step 2:** 更新 proxy 内部引用
- [ ] **Step 3:** 更新 proxy 外部引用（admin/, db/）
- [ ] **Step 4:** 验证 + commit

## Task 4: 拆分 proxy-core.ts + 创建 handler/ 组

从 proxy-core.ts 抽出 headers → transport/headers.ts，error-formatter → handler/error-formatter.ts。
从 proxy-logging.ts + log-helpers.ts 合并为 handler/log-writer.ts。

- [ ] **Step 1:** 创建 transport/headers.ts
- [ ] **Step 2:** 创建 handler/error-formatter.ts
- [ ] **Step 3:** 创建 handler/log-writer.ts
- [ ] **Step 4:** 更新所有引用
- [ ] **Step 5:** 删除旧文件
- [ ] **Step 6:** 验证 + commit

## Task 5: 最终验证 + 测试文件 import 修复

- [ ] **Step 1:** 修复测试文件 import 路径
- [ ] **Step 2:** 全量测试 + lint
- [ ] **Step 3:** Commit

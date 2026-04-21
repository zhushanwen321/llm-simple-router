# Proxy 并发控制架构重构 - 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 proxy 层从 God Function 模式重构为三层架构 + Resource Scope，消除手动资源管理导致的并发 bug。

**Architecture:** TransportLayer（流状态机）→ ResilienceLayer（统一 retry/failover）→ ProxyOrchestrator（编排），横切 SemaphoreScope/TrackerScope 用 try/finally 保证资源释放。

**Tech Stack:** TypeScript, Vitest, better-sqlite3 (in-memory), vi.mock/vi.fn for test mocking

**Spec:** `.superpowers/2026-04-22-proxy-concurrency-refactor/spec.md`

---

## 分支策略

从 main 创建 `refactor/proxy-concurrency` 作为 dev 分支，3 个 PR 依次合并到 dev，最终 dev → main。

当前在 `fix/semaphore-release-and-monitor` 分支，先完成该分支工作并合并，再从 main 创建 dev 分支。

## 前置准备

### Task 0: 创建 dev 分支

- [ ] 确认 `fix/semaphore-release-and-monitor` 已合并到 main
- [ ] `git checkout main && git pull`
- [ ] `git checkout -b refactor/proxy-concurrency`
- [ ] `git push -u origin refactor/proxy-concurrency`

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `src/proxy/transport.ts` | TransportLayer + StreamProxy 状态机 + TransportResult 类型 |
| `src/proxy/resilience.ts` | ResilienceLayer + ResilienceDecision + ResilienceState |
| `src/proxy/scope.ts` | SemaphoreScope + TrackerScope + ProviderSwitchNeeded 异常 |
| `src/proxy/orchestrator.ts` | ProxyOrchestrator + RequestContext |
| `tests/transport.test.ts` | TransportLayer 全 mock 测试 |
| `tests/resilience.test.ts` | ResilienceLayer 全 mock 测试 |
| `tests/scope.test.ts` | Scope 全 mock 测试 |
| `tests/orchestrator.test.ts` | Orchestrator 集成 mock 测试 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/proxy/proxy-core.ts` | PR-3 重写为薄 shim，最终可能删除 |
| `src/proxy/openai.ts` | PR-3 适配新 Orchestrator 接口 |
| `src/proxy/anthropic.ts` | PR-3 适配新 Orchestrator 接口 |
| `src/proxy/proxy-logging.ts` | PR-2 适配新 TransportResult 类型 |
| `src/index.ts` | PR-3 更新依赖注入 |

### 删除文件

| 文件 | PR |
|------|-----|
| `src/proxy/upstream-call.ts` | PR-1（被 transport.ts 替代） |
| `src/proxy/retry.ts` | PR-2（被 resilience.ts 替代） |

### 不动文件

`semaphore.ts`, `retry-rules.ts`, `retry-rules.ts`, `log-helpers.ts`, `enhancement-handler.ts`, `directive-parser.ts`, `model-state.ts`, `response-cleaner.ts`, `mapping-resolver.ts`, `strategy/*`, `sse-metrics-transform.ts`, `metrics-extractor.ts`

## 循环依赖解决

当前 `proxy-core.ts` re-export `ProxyResult`/`StreamProxyResult` 从 `upstream-call.ts`，而 `retry.ts` 又从 `proxy-core.ts` 导入这些类型。重构后：

1. 新建 `src/proxy/types.ts` 放置 `TransportResult`、`RawHeaders`、`UPSTREAM_SUCCESS` 等共享类型
2. 所有新文件从 `types.ts` 导入类型，消除循环
3. PR-1 阶段创建 types.ts，PR-3 阶段删除 proxy-core.ts 中的旧 re-export

---

## 详细子计划

每个 PR 有独立的详细计划文档：

- [PR-1: TransportLayer 重构](./plan-pr1-transport.md)
- [PR-2: ResilienceLayer 重构](./plan-pr2-resilience.md)
- [PR-3: 横切层 + Orchestrator 重构](./plan-pr3-orchestrator.md)

## 执行顺序

PR-1 → PR-2 → PR-3 严格顺序。每个 PR 完成后跑全量测试确认无回归。

```bash
npx vitest run        # 每个 PR 完成后
npm run lint          # 每个 PR 完成后
npx tsc --noEmit      # 每个 PR 完成后
```

---

## 执行方式

Plan complete. Two execution options:

**1. Subagent-Driven (recommended)** - 每个 Task/Step 派发一个新 subagent，step 之间 review，快速迭代

**2. Inline Execution** - 在当前 session 内使用 executing-plans 批量执行，带 checkpoint review

启动执行前，先完成当前分支 `fix/semaphore-release-and-monitor` 合并到 main，然后从 main 创建 `refactor/proxy-concurrency` dev 分支（已完成），所有 PR 分支从 dev 创建。

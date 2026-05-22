---
verdict: pass
---

# E2E Test Plan — Pipeline + Extension 架构深化

## Test Environment

- **Backend:** Fastify test server via `app.inject()` (no real HTTP server)
- **Database:** `:memory:` SQLite (in-memory, test isolation)
- **Mock upstream:** `http.createServer()` on random port, simulating OpenAI/Anthropic responses
- **Test framework:** Vitest 3.1.2, globals enabled

## Test Scenarios

### TS-1: PipelineDeps 结构化验证

覆盖 AC-1。

| 步骤 | 操作 | 期望结果 |
|------|------|---------|
| 1 | 构建 test app (`buildApp({ config, db })`) | app 启动成功 |
| 2 | 发送 OpenAI chat completion 请求 | 请求通过 Pipeline，返回 200 |
| 3 | 验证 failover-loop.ts 中无 metadata.set("db") 等调用 | 代码审查通过 |
| 4 | 验证 15 个 hook 中无 metadata.get("db") as T | 代码审查 + 编译通过 |
| 5 | 验证 PipelineContext.deps 字段存在 | TypeScript 编译通过 |

### TS-2: Failover 控制流统一

覆盖 AC-2。

| 步骤 | 操作 | 期望结果 |
|------|------|---------|
| 1 | Mock backend 返回 502 | resilienceResult.action === 'switch_provider' |
| 2 | 验证 failover-loop 切换到下一个 target | 第二次请求发送到不同 provider |
| 3 | 验证无 ProviderSwitchNeeded throw/catch | 代码审查：resilience.ts 中无 throw，failover-loop 中无 catch |
| 4 | 验证所有 target 耗尽时返回 503 | 最终响应 statusCode === 503 |

### TS-3: TransportExecutor 提取

覆盖 AC-3。

| 步骤 | 操作 | 期望结果 |
|------|------|---------|
| 1 | 发送流式请求 | SSE 流正常返回 |
| 2 | 发送非流式请求 | JSON 响应正常返回 |
| 3 | 验证 transport-execute hook ≤ 20 行 | wc -l ≤ 20 |
| 4 | TransportExecutor 单元测试（mock orchestrator）| 测试通过 |

### TS-4: Format 子系统

覆盖 AC-4a/b/c。

| 步骤 | 操作 | 期望结果 |
|------|------|---------|
| 1 | 验证 format/converters/ 目录不存在 | ls 失败 |
| 2 | 验证 register-converters.ts 包含 6 对转换 | grep 验证 |
| 3 | OpenAI→Anthropic 流式转换 | SSE 事件格式正确 |
| 4 | Anthropic→OpenAI 流式转换 | SSE 事件格式正确 |
| 5 | Chat↔Responses 流式转换 | SSE 事件格式正确 |
| 6 | FormatRegistry 高阶方法测试 | 无 converter 时原样返回 |

### TS-5: Admin 工具函数

覆盖 AC-5。

| 步骤 | 操作 | 期望结果 |
|------|------|---------|
| 1 | GET /admin/api/providers | 200 + 数据正确 |
| 2 | POST /admin/api/providers | 201 + 创建成功 |
| 3 | PUT /admin/api/providers/:id | 200 + 更新成功 |
| 4 | 验证 admin/constants.ts 不存在 | ls 失败 |
| 5 | 验证 providers.ts 行数减少 | wc -l < 502 |

### TS-6: 双注册表合并

覆盖 AC-6。

| 步骤 | 操作 | 期望结果 |
|------|------|---------|
| 1 | GET /admin/api/monitor/hooks | 200 + 返回 15 个 hook 信息 |
| 2 | 验证返回字段包含 name/priority/phase/core | JSON schema 验证 |
| 3 | 验证 hook-registry.ts 不存在 | ls 失败 |

## 回归测试

每次 Phase 完成后运行：
- `npm test` — 全量测试通过
- `npm run lint` — 0 error 0 warning
- `npx tsc --noEmit` — 0 type error

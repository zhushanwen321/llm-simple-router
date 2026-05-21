---
verdict: pass
---

# E2E Test Plan — Pipeline 全量接管

## Test Scenarios

覆盖 spec AC1-AC8 的端到端测试场景。所有场景基于现有测试基础设施（`buildTestApp` + mock backend）。

### Scenario Group 1: Pipeline emit 验证（AC1）

| ID | 场景 | 验证点 |
|----|------|--------|
| E2E-01 | 非流式成功请求 | post_route + pre_transport + post_response 三个 phase 的 emit 被调用 |
| E2E-02 | 流式成功请求 | 同 E2E-01，确认流式场景也触发 |
| E2E-03 | 请求失败触发 on_error | emit("on_error") 被调用 |

验证方法：在 ProxyPipeline 中 spy emit 调用，或通过 hook 副作用（如写入 ctx.metadata）验证。

### Scenario Group 2: 功能等价（AC5）

| ID | 场景 | 验证点 |
|----|------|--------|
| E2E-04 | OpenAI 非流式 | status 200, body.choices[0].message.content 正确 |
| E2E-05 | OpenAI 流式 | SSE data 流完整，以 [DONE] 结束 |
| E2E-06 | Anthropic 非流式 | status 200, content[0].text 正确 |
| E2E-07 | Anthropic 流式 | SSE event 流完整 |
| E2E-08 | 跨格式转换（openai→anthropic） | body 被转换，effectiveApiType 正确 |
| E2E-09 | Failover（第一个 target 失败） | 自动切换到第二个 target，响应成功 |
| E2E-10 | 重试（retry rule 匹配 429） | 重试后成功 |
| E2E-11 | 溢出重定向 | 大 context 切换到 overflow model |
| E2E-12 | 模态重定向 | image 模型切换 |
| E2E-13 | allowed_models 拦截 | 403 返回 |

### Scenario Group 3: 日志指标等价（AC6）

| ID | 场景 | 验证点 |
|----|------|--------|
| E2E-14 | 成功请求日志 | request_logs 包含 pipeline_snapshot, mapping_reason, transport_kind |
| E2E-15 | 失败请求日志 | request_logs 包含 error_message |
| E2E-16 | 指标采集 | request_metrics 包含 input_tokens, output_tokens, ttft |

### Scenario Group 4: Hook 激活（AC3）

| ID | 场景 | 验证点 |
|----|------|--------|
| E2E-17 | overflow-redirect 执行 | hook execute() 被调用 |
| E2E-18 | provider-patches 执行 | hook execute() 被调用 |
| E2E-19 | request-logging 执行 | hook execute() 被调用 |

### Scenario Group 5: 扩展性（AC8）

| ID | 场景 | 验证点 |
|----|------|--------|
| E2E-20 | 外部 hook priority 排序 | priority 200 的 hook 在 builtin 之后执行 |

## Test Environment

- **Framework:** Vitest（现有配置）
- **App:** `buildTestApp({ config, db: initDatabase(":memory:") })`
- **Mock backend:** `http.createServer()` 在随机端口模拟上游
- **Data:** 内存 SQLite，每次测试独立隔离
- **运行方式:** `npx vitest run tests/proxy/`

### 前置条件

- BG1（所有 6 个 hook + pipeline.ts 修改）完成
- BG2（failover-loop 重写）完成
- `npm run build` 通过

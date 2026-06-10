---
verdict: pass
---

# E2E Test Plan — Pipeline Architecture Refactor

## Test Scenarios

### Scenario 1: buildApp 拆分后行为等价
- 启动 `buildApp({ db: inMemory })` 成功
- `/health` 返回 200
- proxy handler 注册正确（POST /v1/chat/completions 可达）
- Admin API 可达（GET /admin/api/hooks 返回 hook 列表）

### Scenario 2: hook-registry 合并后 Admin API 不变
- `GET /admin/api/hooks` 返回与合并前相同的 JSON 结构
- 每个 phase 包含正确的 hook 列表（name + priority）

### Scenario 3: emit 异常降级
- core hook 抛异常 → 传播到调用方
- 非 core hook 抛异常 → 被捕获并 log，后续 hook 继续执行
- 无 hook 的 phase → emit 正常返回

### Scenario 4: stream-oa2ant 转换等价
- 文本流转换输出与重写前一致
- thinking (reasoning_content) 流转换正确
- tool_calls 多索引流转换正确
- finish_reason 映射正确（stop→end_turn, tool_calls→tool_use）
- usage 统计正确（input/output/cache_read tokens）

### Scenario 5: failover-loop 提取后循环行为不变
- 单 target 成功请求
- 多 target failover（第一个失败，第二个成功）
- 全部 target 耗尽返回 503
- 超过 MAX_FAILOVER_ITERATIONS 返回 503

## Test Environment

- Node.js 测试环境，无需启动真实服务器
- Vitest 组件测试模式：`buildApp({ db: ":memory:" })` + `app.inject()`
- Mock 后端：`http.createServer()` 在随机端口模拟上游响应

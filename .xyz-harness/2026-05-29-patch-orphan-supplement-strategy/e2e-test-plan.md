---
verdict: pass
---

# E2E Test Plan — patch-orphan-supplement-strategy

## Test Scenarios

### TS-1: 反向补配对（AC-1）
构建含孤儿 tool_call 的消息链，验证补入合成 tool 消息后 DeepSeek API 接受请求。

### TS-2: 正向删除 + 合并（AC-2, AC-3）
构建含孤儿 tool 消息的消息链，验证删除后连续 user 正确合并。

### TS-3: Step 4 重排（AC-4）
构建 assistant(tool_calls) → user(interrupt) → tool → assistant 的穿插链路，验证重排正确。

### TS-4: 幂等性（AC-5）
对正常配对链路执行 patch，验证 JSON 前后一致。

### TS-5: 边界条件（AC-6, AC-7）
空 ID 忽略 + 末尾 assistant 跳过。

### TS-6: 回归（AC-8, AC-9, AC-10）
全部测试通过 + Step 6/opencode.ai 已移除 + 合成消息 id/content 固定。

## Test Environment

- 单元测试：`npx vitest run router/tests/patch.test.ts`
- 无需启动服务器，使用 `buildApp` + `app.inject()` 模式
- Mock 后端验证 API 格式（如需集成测试）

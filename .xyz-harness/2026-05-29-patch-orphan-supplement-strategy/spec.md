---
verdict: pass
---

# patchOrphanToolResultsOA: 从"删除"策略重构为"补配对"策略

## Background

`patchOrphanToolResultsOA` 是路由器的 DeepSeek patch 体系的一部分，负责修复 OpenAI 格式消息链中 tool_calls / tool 消息的配对断裂。配对断裂由 Claude Code 的 context compact（上下文压缩）截断消息链时产生。

当前策略是"删除"：删除孤儿 tool_call 条目、删除孤儿 tool 消息、删除空壳 assistant、合并连续消息。经过 7 次迭代（commit `8250c30` → `a0393cc`），每次都在补上一个边界 case 的连锁清理逻辑，代码膨胀到 6 个 Step，且 Step 5/6 引入了不属于 DeepSeek patch 职责的通用逻辑。

调研发现：
1. **Claude Code 的 `ensureToolResultPairing`**（`messages.ts:5133`）对反向场景采用"补合成 tool_result"策略——复用已有 id，插入 `is_error: true` 的占位内容
2. **LiteLLM** 的 `_ensure_tool_results_have_corresponding_tool_calls` 对正向场景（有 tool 消息无 tool_calls）从缓存重建 tool_call 定义补到 assistant 中
3. **pi-mono / LangChain** 不做消息链修复

### 核心问题

当前"删除"策略有三个副作用：

1. **信息丢失**：删除 tool_call 等于让模型忘记做过什么操作，可能导致重复操作或推理不一致
2. **连锁复杂度**：删除后需要清理空壳、合并连续消息、重排顺序，逻辑越补越多
3. **KV cache 破坏**：删除 tool_call 改变了已有 assistant 消息的内容，导致后续请求的 cache miss

### 实际数据验证

- 路由器本地 DB 中 548 条消息的 ds-flash 请求：孤儿消息 **0 条**（pi coding agent 不做 compact）
- `upstream_error_logs` 中 deepseek 400 错误仅 2 条（2026-05-26，`client_agent_type=claude-code`），错误类型为 "insufficient tool messages following tool_calls message"
- 同期 deepseek 的其他错误均为 `image_url` 格式问题（另一个独立问题）
- 当前所有 tool_calls id 非空，格式为 `call_XXXX` 或 `call_NN_XXXX`

## Functional Requirements

### FR-1: 反向场景改为"补"策略

**场景**：非末尾 assistant 有 tool_calls，但部分或全部 tool_call_id 没有对应的 `role:"tool"` 消息。

**当前行为**：从 assistant 中删除孤儿 tool_call 条目；如果全部删除则删 `tool_calls` 字段；如果 content 也为空则删整条 assistant。

**改为**：为每个孤儿 tool_call_id 插入合成 tool 消息，内容为固定占位字符串，紧跟在该 assistant 消息之后。

### FR-2: 正向场景保持"删"策略（与 Claude Code 一致）

**场景**：有 `role:"tool"` 消息，但其 `tool_call_id` 没有对应 assistant tool_calls 中的 id。

**行为**：删除孤儿 tool 消息。这与 Claude Code 的 `ensureToolResultPairing` 策略一致。

### FR-3: Tool Call Cache（可选增强）

**场景**：正向场景中删除了孤儿 tool 消息后，如果后续发现该 tool_call_id 出现在更早的 assistant 的 tool_calls 中（跨消息配对），则可以从缓存恢复。

**行为**：在处理消息链时，维护一个 `tool_call_id → tool_call definition` 的缓存。正向场景优先从缓存查找配对，避免误删。

### FR-4: 移除连锁清理逻辑

以下 Step 应被移除或大幅简化，因为"补"策略不会产生需要清理的副作用：

| Step | 当前行为 | 改后是否需要 |
|------|---------|------------|
| 空壳 assistant 清理 | 删除 content 为空且无 tool_calls 的 assistant | 不需要（不再删 tool_calls，不会产生空壳） |
| 连续 user 合并 | 删孤儿 tool 后合并连续 user | 简化（正向删除后可能仍需合并） |
| Step 4: 重排穿插消息 | 将 tool 消息挪到 assistant 后面 | 保留（这是独立的位置修复，与补/删无关） |
| Step 5: 合并连续 assistant | 合并连续 assistant 的 content 和 tool_calls | 不需要（补策略不会产生连续 assistant） |
| Step 6: 补 reasoning_content | 为所有 tool_calls assistant 注入 reasoning_content="" | 移除（属于 provider 特定逻辑，不属于孤儿修复） |

### FR-5: 移除 `needsDeepSeekPatch` 中的 opencode.ai hack

`opencode.ai` 触发条件应从 `needsDeepSeekPatch` 中删除。Step 6 的 reasoning_content 注入如果确实需要，应作为独立的 provider 特定 patch（通过 DB 配置驱动），不属于孤儿修复。

## Acceptance Criteria

### AC-1: 反向补配对

**Given** 消息链中有一条非末尾 assistant 含 `tool_calls: [{id: "call_abc"}, {id: "call_def"}]`，但只有 `role:"tool", tool_call_id: "call_abc"` 存在

**When** `patchOrphanToolResultsOA` 执行

**Then**：
- `call_abc` 的 tool 消息保持不变
- 在该 assistant 后面插入合成 tool 消息：`{role: "tool", tool_call_id: "call_def", content: "[context truncated]"}`
- assistant 的 tool_calls 不被修改

### AC-2: 正向删除

**Given** 有 `role:"tool", tool_call_id: "call_orphan"` 消息，但没有任何 assistant 的 tool_calls 含 `call_orphan`

**When** `patchOrphanToolResultsOA` 执行

**Then**：该 tool 消息被删除

### AC-3: 正向删除后合并连续 user

**Given** 正向删除后产生两条连续 user 消息

**When** 合并逻辑执行

**Then**：两条 user 消息合并为一条（content 用 `\n` 连接）

### AC-4: Step 4 重排保留

**Given** `assistant(tool_calls=[A,B])` 后面跟了 `user(interrupt)`, `tool(B)`, `tool(A)`

**When** `patchOrphanToolResultsOA` 执行

**Then**：重排为 `assistant(tool_calls=[A,B])`, `tool(B)`, `tool(A)`, `user(interrupt)`

### AC-5: 幂等性

**Given** 一条正常配对的消息链（无孤儿、无穿插）

**When** `patchOrphanToolResultsOA` 执行

**Then**：消息链不变（JSON 序列化前后一致）

### AC-6: 空 ID 处理

**Given** assistant 有 `tool_calls: [{id: "", function: ...}]`

**When** `patchOrphanToolResultsOA` 执行

**Then**：空 ID 的 tool_call 被忽略（不补、不删），保持现有行为

### AC-7: 末尾 assistant 跳过

**Given** 消息链最后一条是 assistant 含 tool_calls（正常中间状态）

**When** `patchOrphanToolResultsOA` 执行

**Then**：不为其补合成 tool 消息

### AC-8: 现有测试全部通过

**Given** 运行 `npx vitest run router/tests/patch.test.ts`

**When** 重构完成后

**Then**：所有测试通过（需更新因策略变化而失败的测试用例的期望值）

### AC-9: Step 6 和 opencode.ai hack 被移除

**Given** 重构后的代码

**When** 检查 `patchOrphanToolResultsOA` 和 `needsDeepSeekPatch`

**Then**：
- `patchOrphanToolResultsOA` 不包含 reasoning_content 注入逻辑
- `needsDeepSeekPatch` 不包含 `opencode.ai` 匹配

### AC-10: KV cache 友好

**Given** 补入的合成 tool 消息

**When** 相同 session 的后续请求包含相同的消息链

**Then**：合成 tool 消息的 `tool_call_id` 和 `content` 与前一次完全一致，不会破坏 KV cache

## Constraints

1. **ID 不变**：补入的合成 tool 消息使用原始 `tool_calls[].id`，不生成新 ID
2. **Content 固定**：合成 tool 消息的 content 使用固定字符串 `"[context truncated]"`，保证幂等和 cache 友好
3. **Anthropic 格式不变**：`patchOrphanToolResults`（Anthropic 版本）本次不做改动，仅重构 OpenAI 版本 `patchOrphanToolResultsOA`
4. **provider 特定逻辑分离**：reasoning_content 注入等 provider 特定需求不属于孤儿修复，应通过 `patchThinkingConsistency` 或 DB 配置驱动
5. **兼容现有 API**：`patchOrphanToolResultsOA` 的函数签名不变（`body: Record<string, unknown>` → `void`）
6. **Tool Call Cache 为可选增强**：如果实现复杂度超预期，可以降级为仅补固定占位内容，不做缓存查找

## 业务用例

### UC-1: Claude Code compact 后的请求通过路由器
- **Actor**: Claude Code 客户端（通过路由器访问 DeepSeek）
- **场景**: Claude Code 做 context compact 后，消息链中 assistant 的 tool_calls 部分配对断裂（反向孤儿）
- **预期结果**: 路由器自动补入合成 tool 消息，DeepSeek 接受请求并正常响应，不产生 400 错误

### UC-2: Failover 跨 provider 后的消息链兼容
- **Actor**: 路由器的 failover 机制
- **场景**: 从 ds-flash failover 到 kimi-for-coding，消息链可能有不同 provider 的格式要求
- **预期结果**: 消息链通过通用规范化后满足目标 provider 的格式要求

## Complexity Assessment

**Medium** — 核心改动集中在单个函数（`patchOrphanToolResultsOA`），涉及策略替换和连锁逻辑简化。Tool Call Cache 为可选增强项，复杂度可控。测试用例需要根据新策略调整期望值。

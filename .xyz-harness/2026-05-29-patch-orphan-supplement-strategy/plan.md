---
verdict: pass
complexity: L1
---

# patchOrphanToolResultsOA: 补配对策略重构 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use xyz-harness-subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task.

**Goal:** 将 `patchOrphanToolResultsOA` 的反向孤儿处理从"删除 tool_call"改为"补入合成 tool 消息"，移除 Step 5/6 和 opencode.ai hack。

**Architecture:** 单文件重构。保留正向删除逻辑和 Step 4 重排逻辑，替换反向处理逻辑，删除 Step 5/6，清理 needsDeepSeekPatch。

**Tech Stack:** TypeScript, Vitest, Fastify（测试用）

---

## File Structure

| File | Type | Group | Description |
|------|------|-------|-------------|
| `router/src/proxy/patch/deepseek/patch-orphan-tool-results.ts` | modify | BG1 | 重构 `patchOrphanToolResultsOA` 函数 |
| `router/src/proxy/patch/index.ts` | modify | BG1 | 移除 `needsDeepSeekPatch` 中的 opencode.ai 条件 |
| `router/tests/patch.test.ts` | modify | BG1 | 更新测试用例匹配新策略 |

## Interface Contracts

### Module: patch-orphan-tool-results

#### Function: patchOrphanToolResultsOA

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| patchOrphanToolResultsOA | (body: Record<string, unknown>) => void | void | 空 messages → early return; 末尾 assistant → 跳过补入; 空 id → 忽略 | AC-1~AC-10 |

#### Data: SyntheticToolMessage（内部构造，不导出）

| Field | Type | Description |
|-------|------|-------------|
| role | `"tool"` | 固定值 |
| tool_call_id | `string` | 复用 tool_calls[].id |
| content | `"[context truncated]"` | 固定占位字符串 |

## Spec Coverage Matrix

| Spec AC | Interface Method | Data Flow | Task |
|---------|-----------------|-----------|------|
| AC-1 反向补配对 | patchOrphanToolResultsOA | reverse supplement logic → synthetic tool msg | Task 1 |
| AC-2 正向删除 | patchOrphanToolResultsOA | forward delete logic (unchanged) | Task 1 |
| AC-3 正向删除后合并连续 user | patchOrphanToolResultsOA | merge consecutive user after forward delete | Task 1 |
| AC-4 Step 4 重排保留 | patchOrphanToolResultsOA | reorder intervening msgs (unchanged) | Task 1 |
| AC-5 幂等性 | patchOrphanToolResultsOA | no-op on clean chain | Task 2 |
| AC-6 空 ID 处理 | patchOrphanToolResultsOA | skip empty id in supplement | Task 1 |
| AC-7 末尾 assistant 跳过 | patchOrphanToolResultsOA | skip lastIdx in reverse scan | Task 1 |
| AC-8 现有测试全部通过 | — | all tests pass | Task 2 |
| AC-9 Step 6 和 opencode.ai hack 移除 | needsDeepSeekPatch + patchOrphanToolResultsOA | remove code | Task 1 |
| AC-10 KV cache 友好 | patchOrphanToolResultsOA | fixed content + reuse id | Task 1 |

## Spec Metrics Traceability

| Spec 指标 | 采纳状态 | 对应 Task |
|-----------|---------|----------|
| AC-1 反向补配对 | adopted | Task 1 |
| AC-2 正向删除 | adopted | Task 1 |
| AC-3 合并连续 user | adopted | Task 1 |
| AC-4 重排保留 | adopted | Task 1 |
| AC-5 幂等性 | adopted | Task 2 |
| AC-6 空 ID | adopted | Task 1 |
| AC-7 末尾跳过 | adopted | Task 1 |
| AC-8 测试通过 | adopted | Task 2 |
| AC-9 Step 6/opencode.ai 移除 | adopted | Task 1 |
| AC-10 KV cache 友好 | adopted | Task 1（固定 content + 复用 id，无需额外实现）|
| FR-3 Tool Call Cache | postponed | 复杂度超预期，降级为固定占位。后续迭代可加 |

---

## Task List

### Task 1: 重构 patchOrphanToolResultsOA + 移除 opencode.ai hack

**Type:** backend

**Files:**
- Modify: `router/src/proxy/patch/deepseek/patch-orphan-tool-results.ts`
- Modify: `router/src/proxy/patch/index.ts`

**描述：**

修改 `patchOrphanToolResultsOA` 的反向处理逻辑，并删除 Step 5/6 代码。

**反向逻辑变更（核心改动）：**

当前代码（第 136-162 行）：
1. 收集所有 tool 消息的 ID → `knownToolMsgIds`
2. 遍历非末尾 assistant，过滤掉不在 `knownToolMsgIds` 中的 tool_call
3. 如果全部移除则 `delete msg.tool_calls`，否则用 filtered 替换

改为：
1. 收集所有 tool 消息的 ID → `knownToolMsgIds`（保持不变）
2. 遍历非末尾 assistant，找出不在 `knownToolMsgIds` 中的孤儿 tool_call id
3. 为每个孤儿 id 插入合成 tool 消息：`{ role: "tool", tool_call_id: id, content: "[context truncated]" }`
4. 插入位置：紧跟在该 assistant 消息之后，在已有的 tool 消息之前（或之后，取决于具体位置）
5. 空 id（`!id`）的 tool_call 忽略，不补不删

**插入位置策略：** 采用 Claude Code 的方案——在 assistant 消息后追加合成 tool 消息。如果 assistant 后面已有部分配对的 tool 消息，合成消息追加在它们之后。用 `messages.splice(assistantIdx + 1, 0, ...syntheticMsgs)` 在 assistant 后面批量插入。

**需要移除的代码：**

1. **空壳 assistant 清理**（第 165-174 行）— 不再需要，因为不删 tool_calls，不会产生空壳
2. **连续 user 合并**（第 176-186 行）— 保留！正向删除后仍可能产生连续 user
3. **Step 5：合并连续 assistant**（第 233-251 行）— 不再需要，补策略不会产生连续 assistant
4. **Step 6：补 reasoning_content**（第 253-260 行）— 移除，属于 provider 特定逻辑

**needsDeepSeekPatch 变更：**

文件 `router/src/proxy/patch/index.ts` 第 116 行：
```typescript
// 删除这一行：
if (provider.base_url.includes("opencode.ai")) return true;
```

**changed 标志位简化：** 补策略总是需要 `changed = true`（因为插入了新消息），所以正向删除后不需要重新判断 changed。但需要注意：反向补入是插入操作，会改变 messages 数组长度，后续的 Step 4 重排索引需要考虑这个变化。

**执行顺序（重构后）：**
1. 正向：移除孤儿 tool 消息
2. 反向：为孤儿 tool_call 补入合成 tool 消息
3. 合并连续 user 消息（如果 changed）
4. Step 4：重排穿插消息

**关键实现细节：**
- 反向遍历 assistant 时用逆序（从后向前），这样插入消息不影响前面 assistant 的索引
- 合成 tool 消息的 `content` 使用常量 `"[context truncated]`，不要提取为模块级常量（仅使用一次）
- 反向遍历完成后，如果任何 assistant 有孤儿被补入，标记 `changed = true`

### Task 2: 更新测试用例

**Type:** backend

**Files:**
- Modify: `router/tests/patch.test.ts`

**描述：**

更新 `patchOrphanToolResultsOA` describe 块中的测试用例，使其期望值匹配新的"补"策略。

**需要更新的测试（7 个）：**

1. **"反向：移除非末尾 assistant 中无对应 tool 消息的 tool_call 条目"**（第 195 行）
   - 旧期望：`tool_calls` 被删除，空壳 assistant 清理，user 合并为 1 条
   - 新期望：`tool_calls` 保留，插入合成 tool 消息 `{ role: "tool", tool_call_id: "orphan_1", content: "[context truncated]" }`
   - 最终消息链：`[user, assistant(tool_calls=[orphan_1]), tool(orphan_1, synthetic), user("你找到了什么?")]`

2. **"反向：部分配对时只移除未配对的 tool_call，保留已配对的"**（第 219 行）
   - 旧期望：`orphan` tool_call 被删除，只剩 `matched`
   - 新期望：两个 tool_call 都保留，`orphan` 后面补入合成 tool 消息
   - 最终消息链：`[assistant(tool_calls=[matched, orphan]), tool(matched, ok), tool(orphan, "[context truncated]"), assistant("done")]`

3. **"反向：Claude Code 截断场景的完整消息链修复"**（第 232 行）
   - 旧期望：toolu_1 的 tool_calls 被删除，空壳 assistant 清理，user 合并
   - 新期望：toolu_1 保留 tool_calls，补入合成 tool 消息
   - 最终消息链：`[system, user("read file.ts"), assistant(tool_calls=[toolu_1]), tool(toolu_1, synthetic), user("你找到了什么?"), assistant(tool_calls=[toolu_2]), tool(toolu_2, ok), assistant("这是 other.ts 的内容"), user("继续")]`

4. **"反向清理：空壳 assistant 被移除后连续 user 合并"**（第 360 行）
   - 旧期望：空壳 assistant 清理，user 合并
   - 新期望：tool_calls 保留，补入合成 tool 消息，不再有空壳清理
   - 最终消息链：`[user("read a file"), assistant(tool_calls=[orphan_1]), tool(orphan_1, synthetic), user("你找到了什么?"), assistant("这是结果")]`

5. **"Step 4: 部分 tool 消息匹配时不重排"**（第 309 行）
   - 旧期望依赖反向删除 behavior，需根据新 behavior 调整
   - 新期望：call_b 补入合成 tool 后，assistant 有两个 tool_calls 都有配对（call_a 有真实 tool，call_b 有合成 tool），Step 4 可以正常重排

6. **"混合场景：保留配对的，移除孤儿的"**（第 167 行）
   - 此测试的正向删除部分不变（`call_ghost` 仍是孤儿 tool 消息）
   - 但需要检查反向部分是否受影响——此测试没有反向孤儿，应该不变

7. **新增测试："反向补入的合成消息内容固定"**
   - 验证补入的合成 tool 消息 content 恰好是 `"[context truncated]"`
   - 验证 tool_call_id 与原始 tool_calls[].id 一致

**不需要更新的测试（4 个）：**
- "保留有匹配 tool_calls 的 tool 消息" — 无孤儿，行为不变
- "末尾 assistant 的 tool_calls 保持不动" — 不变
- "空 messages 时安全返回" — 不变
- "Step 4: 无 intervening 消息时不做任何修改" — 不变（这个测试之前就因 Step 6 的 reasoning_content 注入而失败，修复后应通过）

**Step 6 移除的影响：** 当前代码的 Step 6 会给所有带 tool_calls 的 assistant 注入 `reasoning_content: ""`。移除后，"Step 4: 无 intervening 消息时不做任何修改" 测试应该能通过（它检查 `JSON.stringify(body)` 与 `original` 完全一致）。

---

## Execution Groups

#### BG1: 孤儿补配对重构

**Description:** 包含核心逻辑重构、hack 移除和测试更新，全部修改在同一个 patch 模块内，文件关联紧密。

**Tasks:** Task 1, Task 2

**Files (预估):** 3 个文件（0 create + 3 modify）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | 按 taskComplexity 自动选择（executor: high, tdd-coder: medium, reviewer: medium） |
| 注入上下文 | Task 1/2 描述 + spec AC-1~AC-10 + Constraint #1-#6 + CLAUDE.md 编码规范 |
| 读取文件 | `router/src/proxy/patch/deepseek/patch-orphan-tool-results.ts`, `router/src/proxy/patch/index.ts`, `router/tests/patch.test.ts` |
| 修改/创建文件 | 同上 |

**Execution Flow (BG1 内部):** 串行派遣。

  Task 1:
    1. general-purpose (read xyz-harness-test-driven-development + xyz-harness-backend-dev) → 写失败测试
    2. general-purpose (read xyz-harness-backend-dev) → 写实现代码
    3. general-purpose (read xyz-harness-expert-reviewer) → spec 合规检查

  Task 2 (depends on Task 1):
    1. general-purpose (read xyz-harness-test-driven-development) → 更新测试期望值
    2. general-purpose (read xyz-harness-expert-reviewer) → spec 合规检查

**Dependencies:** 无

**设计细节:** 见上方 Task 1/2 描述

---

## Dependency Graph & Wave Schedule

```
BG1 (核心重构 + 测试)

| Wave | Groups | 说明 |
|------|--------|------|
| Wave 1 | BG1 | 全部改动，无依赖 |
```

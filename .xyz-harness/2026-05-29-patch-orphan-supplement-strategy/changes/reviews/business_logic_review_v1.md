---
verdict: pass
must_fix: 0
---

# Business Logic Review — patch-orphan-supplement-strategy

## Reviewed Files

| File | Role |
|------|------|
| `router/src/proxy/patch/deepseek/patch-orphan-tool-results.ts` | 核心变更：反向策略从"删除孤儿 tool_call"改为"补入合成 tool 消息" |
| `router/src/proxy/patch/index.ts` | 次要变更：移除 `opencode.ai` 免检规则 |
| `router/tests/patch.test.ts` | 测试同步更新 |
| `router/src/proxy/patch/deepseek/patch-thinking.ts` | 上下文检查：验证 reasoning_content 逻辑已迁移 |
| `router/src/proxy/patch/deepseek/index.ts` | 上下文检查：patch 执行顺序 |
| `router/src/proxy/patch/deepseek/utils.ts` | 上下文检查：辅助函数 |

## 审查结论

**verdict: pass** — 核心业务逻辑正确，零 MUST FIX 项。

---

## 1. 反向补配对逻辑（核心变更）

### 变更描述

`patchOrphanToolResultsOA()` 的反向分支从"删除非末尾 assistant 中不匹配的 tool_call 条目"改为"为该 assistant 后补入合成 `role: "tool"` 消息"。

### 正确性验证

| 维度 | 结果 | 说明 |
|------|------|------|
| 语义正确性 | ✅ | Claude Code compact 截断 tool 消息后，不是假装没调用过工具，而是告诉模型结果被截断了。`content: "[context truncated]"` 是准确的语义描述 |
| 消息格式 | ✅ | 合成的消息格式为 `{role:"tool", tool_call_id, content}`，符合 OpenAI Chat Completions 规范 |
| 插入位置 | ✅ | `messages.splice(i + 1, 0, ...syntheticMsgs)` 插入在发出 tool_calls 的 assistant 之后，满足 DeepSeek "tool_calls 后必须紧跟 tool 消息"的校验要求 |
| 保留原有 tool_calls | ✅ | assistant 的 `tool_calls` 数组保持不变，不删除、不修改任何条目 |

### 逆序遍历的正确性

从正序遍历改为逆序遍历是关键的正确性保证：

- **旧问题**：正序遍历时，在 index `i` 处删除/修改后，后续索引偏移，需要额外的补偿逻辑
- **新方案**：逆序遍历，`splice(i + 1, 0, ...)` 插入在已处理位置之后，不会影响之前（更低索引）的未处理 assistant
- **验证**：所有测试用例通过，边界场景（多个 assistant 各有孤儿 tool_call）正确

### 收敛性证明

函数是**幂等**的：第二次调用时，已插入的合成 tool 消息的 `tool_call_id` 存在于 `knownToolMsgIds` 中，`knownToolMsgIds.has(id)` 为 `true`，不会重复插入。

---

## 2. 正向删除逻辑（保持不变）

### 验证

正向逻辑（移除孤儿 tool 消息）未做任何修改：

```typescript
// 收集所有 assistant tool_calls IDs
const knownToolCallIds = new Set<string>();
// 逆序遍历，移除 tool_call_id 不在 knownToolCallIds 中的 tool 消息
```

- 保留有匹配 assistant tool_calls 的 tool 消息 ✅
- 移除无对应 tool_calls 的幽灵 tool 消息 ✅
- 与反向补入不冲突：补入的合成 tool 消息的 ID 都在 `knownToolCallIds` 中 ✅
- 与 `applyDeepSeekPatches` 中先于 `patchOrphanToolResultsOA` 调用的 `patchThinkingConsistency` 无干扰 ✅

---

## 3. 合成 tool 消息的内容正确性

| 字段 | 值 | 正确性 |
|------|-----|--------|
| `role` | `"tool"` | ✅ OpenAI 格式正确 |
| `tool_call_id` | 孤儿 tool_call 的 `id` 值 | ✅ 保证与 assistant 的 tool_calls 配对 |
| `content` | `"[context truncated]"` | ✅ 明确告知模型结果被截断（非空字符串，不引发模型误解） |

---

## 4. 边界条件

| 边界 | 处理 | 正确性 |
|------|------|--------|
| **空 ID 忽略** | `if (!id) continue` — tool_call 无 ID 时不补不删 | ✅ 无法配对时不做无意义操作 |
| **末尾 assistant 跳过** | `if (i === messages.length - 1) continue` | ✅ 保留 pending tool_calls（正常的工具调用中间状态） |
| **动态 `messages.length`** | 逆序遍历中 `messages.length` 因 splice 增加，但 `messages.length - 1` 只在检查当前 i 时使用，已处理过的索引不受影响 | ✅ |
| **混合配对** | 部分 tool_call 有对应 tool、部分没有 → 只补没的，已有的保持 | ✅ 测试 `"部分配对时为未配对的 tool_call 补入合成 tool 消息"` 验证 |
| **空 messages** | `if (!messages \|\| !Array.isArray(messages) \|\| messages.length === 0) return` | ✅ 安全返回 |

---

## 5. Step 4 (消息重排) 与新逻辑的交互

### 场景分析

插入合成 tool 消息后，Step 4 的行为变化：

| 场景 | 旧行为 | 新行为 | 正确性 |
|------|--------|--------|--------|
| 全部 tool_call 都有配对 | `expectedIds` 正确清零，重排或跳过 | 同旧行为 | ✅ |
| 部分 tool_call 是孤儿 | 先删孤儿 tool_calls → `expectedIds` 变小 → 可能不触发重排 | 先补合成 tool → `expectedIds` 保持完整 → 扫描找到合成 + 实际 tool 消息后清零 → 触发重排 | ✅ |
| 全部 tool_call 是孤儿 | 删空 tool_calls → 空壳 assistant 被清理 | 合成 tool 全部插入 assistant 后 → `expectedIds` 在扫描开始时即清零（紧邻的合成 tool 全部匹配）→ `intervening` 为空 → 不触发重排（无需重排） | ✅ |

### 合成 tool 消息对 scanLimit 的影响

`scanLimit = idx + 1 + expectedIds.size * SCAN_SLOTS_PER_CALL + SCAN_LIMIT_EXTRA`

合成 tool 插入后 `expectedIds.size` 比旧行为大（因为不再删除孤儿 tool_calls），导致 `scanLimit` 更大。但扫描在 `expectedIds` 清空时就 `break`，更大 limit 不影响正确性。

---

## 6. 移除 Step 5 和 Step 6 的影响

### Step 5: 合并连续 assistant

**移除原因**：旧行为中删除孤儿 tool_call 后，若 assistant 变成空壳（无 tool_calls + 无实质 content），会被删除，导致两侧消息可能变成连续同角色。新行为中 assistant 的 tool_calls 不删除，不会产生空壳 assistant，此步骤不再必要。

**回归风险**：无。此函数只处理本函数产生的消息结构变化；预处理已存在的连续 assistant 不属于本函数职责。

### Step 6: 补 `reasoning_content: ""`

**移除原因**：此功能已由 `applyDeepSeekPatches` 中排在 `patchOrphanToolResultsOA` 之前执行的 `patchThinkingConsistency` → `patchMissingReasoningContent()` 覆盖。

**交叉验证**：

| 维度 | 旧 Step 6 | `patchMissingReasoningContent` | 
|------|-----------|-------------------------------|
| 触发条件 | 无条件 | 需 `body.thinking` 或 `body.reasoning` 已设置 |
| `reasoning_content` 注入前 | `injectThinkingParam` 先扫描历史中的 thinking 痕迹，若存在则设 `body.thinking` | `patchMissingReasoningContent` 检查 `body.thinking` |
| 执行顺序 | `patchOrphanToolResultsOA` 内部 | `patchOrphanToolResultsOA` 之前（`applyDeepSeekPatches` 的调用顺序） |
| 对 tool_calls 的影响 | 无 | 无 |

**结论**：Step 6 的功能被更结构化的 `patch-thinking.ts` 替代，且执行顺序在 orphan patch 之前，不会导致 tool_calls assistant 缺 `reasoning_content`。**无回归**。

---

## 7. 无关变更：移除 `opencode.ai` 免检规则

`index.ts` 中移除了 `if (provider.base_url.includes("opencode.ai")) return true;`。

- **与 orphan supplement 无直接关系**
- **假设**：opencode.ai 已原生支持 DeepSeek 协议，不需要路由器补丁，或已被 DB-driven patches 模式覆盖
- **风险**：若 opencode.ai 仍需要补丁且未通过 DB 配置 patches，可能导致回退模式遗漏此 provider。建议在 spec 中确认此变更的意图

---

## 8. UC 覆盖验证

| UC | 状态 | 说明 |
|----|------|------|
| UC-1: Claude Code compact | ✅ | 合成 tool 消息插入后 DeepSeek 校验通过 |
| UC-2: Failover 跨 provider | ✅ | `needsDeepSeekPatch` 按 provider 决定是否触发，不遗漏不误判 |

---

## 9. 测试覆盖

| 测试用例 | 覆盖维度 | 验证 |
|----------|---------|------|
| 反向补入基本场景 | UC-1 | ✅ |
| 末尾 assistant 保持不动 | 边界 | ✅ |
| 部分配对被补入 | 混合场景 | ✅ |
| Claude Code 完整链截断 | UC-1 完整路径 | ✅ |
| 空 messages | 防御 | ✅ |
| Step 4 合成+重排 | 交互正确性 | ✅ |
| 空壳清理不再发生 | 回归防护 | ✅ |

所有测试期望值与新逻辑一致，无遗漏测试。

---

## 总结

| 检查项 | 结论 |
|--------|------|
| 反向补配对逻辑正确 | ✅ |
| 正向删除逻辑保持不变 | ✅ |
| 合成 tool 消息 content/tool_call_id 正确 | ✅ |
| 边界条件（空ID、末尾跳过、幂等性） | ✅ |
| Step 4 与新逻辑交互正确 | ✅ |
| 移除步骤无回归 | ✅ (reasoning_content 由 patch-thinking.ts 替代) |
| 测试覆盖充分 | ✅ |
| 零 MUST FIX | ✅ — 注意 `opencode.ai` 变更是独立决策，建议确认意图 |

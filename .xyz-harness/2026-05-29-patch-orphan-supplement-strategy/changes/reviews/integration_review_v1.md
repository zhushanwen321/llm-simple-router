---
verdict: pass
must_fix: 0
---

# Integration Review — patch-orphan-supplement-strategy

## Review Scope

检查 `patchOrphanToolResultsOA` 反向策略从"删除孤儿 tool_call"改为"补入合成 tool 消息"后，与系统中其他模块的集成正确性。

## 被审查文件

| 文件 | 角色 |
|------|------|
| `router/src/proxy/patch/deepseek/patch-orphan-tool-results.ts` | 核心变更 |
| `router/src/proxy/patch/deepseek/index.ts` | 调用方：`applyDeepSeekPatches` |
| `router/src/proxy/patch/index.ts` | 调用方链路：`applyProviderPatches` |
| `router/src/proxy/patch/deepseek/patch-thinking.ts` | 流水线前置依赖 |
| `router/src/proxy/handler/failover-loop.ts` | 间接调用方 |
| `router/src/proxy/hooks/builtin/provider-patches.ts` | 间接调用方 |
| `router/tests/patch.test.ts` | 测试 |

---

## 1. `patchOrphanToolResultsOA` 调用方分析

**调用方**：仅 `router/src/proxy/patch/deepseek/index.ts:applyDeepSeekPatches()`

```typescript
export function applyDeepSeekPatches(body, apiType) {
  patchThinkingConsistency(body, apiType);       // 先执行
  if (apiType === "anthropic") {
    patchOrphanToolResults(body);                 // Anthropic 格式
  } else {
    patchOrphanToolResultsOA(body);               // OpenAI 格式 — 本变更
  }
}
```

| 检查项 | 结论 |
|--------|------|
| 函数签名 | **未变** — `(body: Record<string, unknown>): void`，调用的参数和方式完全一致 |
| 返回值类型 | **未变** — `void`，调用方只关注 body 的副作用修改 |
| body 修改语义 | **变了** — 旧：删除 tool_calls；新：补入 tool 消息。调用方 `applyDeepSeekPatches` 和上游 `applyProviderPatches` 不依赖 messages 结构的后置条件（只使用返回的 body 向下游传递） |
| 幂等性 | **保持** — 新逻辑幂等：已补入的合成 tool 的 tool_call_id 会在 `knownToolMsgIds` 中，不会重复补入 |

**Verdict**: ✅ 无集成风险。调用方链路 `applyProviderPatches → applyDeepSeekPatches → patchOrphanToolResultsOA` 在签名、返回值、后置条件依赖上均不受影响。

---

## 2. `applyProviderPatches` 下游调用方分析

两个下游调用方：

### 2.1. `failover-loop.ts` — Failover 期间逐 provider 执行

```typescript
const { body: patchedBody, meta: patchMeta } = applyProviderPatches(currentBody, {
  base_url: provider.base_url,
  api_type: providerInfo.api_type,
  models: providerInfo.models,
});
// patchedBody 直接用于构造上游请求
```

- 通过 `currentBody`（深拷贝的原始请求体）调用
- 只使用返回的 `patchedBody` 构建 upstream 请求
- 不验证 messages 中 tool_calls/tool 的具体配对状态

### 2.2. `provider-patches.ts` — ProviderPatches pipeline hook

```typescript
const { body: patchedBody, meta: patchMeta } = applyProviderPatches(body, { ... });
```

- 同样只使用 `patchedBody` 向下传递
- 不解析 post-patch 消息结构

**Verdict**: ✅ 两个下游调用方均不依赖 patches 后的消息结构细节，无耦合。

---

## 3. `needsDeepSeekPatch` 分析

### 实际变更

此分支对 `router/src/proxy/patch/index.ts` 的变更仅有一处纯风格调整：

```diff
-  return model.includes("deepseek");
+  if (model.includes("deepseek")) return true;
+  return false;
```

**语义完全等价**。`needsDeepSeekPatch` 的逻辑未发生任何行为变化。

### 关于"`opencode.ai` 免检规则移除"的澄清

业务逻辑审查报告中提到 `index.ts` 移除了 `if (provider.base_url.includes("opencode.ai")) return true;`。

通过 `git diff main..HEAD router/src/proxy/patch/index.ts` 和 `git show main:router/src/proxy/patch/index.ts` 确认：**此规则在 `main` 分支中已经不存在**，不是本分支的变更。业务逻辑审查在此处有误。

**Verdict**: ✅ `needsDeepSeekPatch` 无语义变更，不影响任何 patch 的分发。业务逻辑审查中的相关假设（opencode.ai 风险）不适用。

---

## 4. Anthropic 版本 `patchOrphanToolResults` 是否受影响

**完全不受影响。**

| 维度 | 证据 |
|------|------|
| 代码变更 | `patchOrphanToolResults`（Anthropic 格式）在本分支中**零改动** |
| 算法 | 仍使用"删除无主块"策略（这是 Anthropic content-block 格式的正确做法） |
| 调用方 | `applyDeepSeekPatches` 中仍通过 `apiType === "anthropic"` 分支进入 |
| 与 OA 版本隔离 | 两个函数各自调用，互不干扰。anthropic 分支不会到达 OA 版本，反之亦然 |

**Verdict**: ✅ Anthropic 格式的 orphan tool 修复功能与此变更完全正交，无影响。

---

## 5. `patchThinkingConsistency` / `patchMissingReasoningContent` 是否受影响

**完全不受影响。**

| 维度 | 证据 |
|------|------|
| 代码变更 | `patch-thinking.ts` 在本分支中**零改动** |
| 执行顺序 | `applyDeepSeekPatches` 中先执行 `patchThinkingConsistency(body, apiType)`，再执行 orphan patch。**先于** orphan patch 运行 |
| 数据传递 | `patchMissingReasoningContent` 设置 `msg.reasoning_content = ""`，`patchOrphanToolResultsOA` 读取 `msg.role` 和 `msg.tool_calls`。两者操作不同的字段，无写冲突 |
| 依赖关系 | orphan patch 不依赖 `reasoning_content` 的值 |

**Verdict**: ✅ thinking consistency patch 在时序和数据上均与 orphan patch 无冲突。

---

## 6. Step 4 消息重排 — 补策略下的行为验证

### 6.1. 基本流程

```typescript
// 反向补入阶段（逆序执行）
for (let i = messages.length - 1; i >= 0; i--) {
  if (orphans.length > 0) {
    messages.splice(i + 1, 0, ...syntheticMsgs);  // ← 补在 assistant 之后
  }
}

// Step 4 重排阶段（正序执行）
for (let idx = 0; idx < messages.length; idx++) {
  // 扫描 assistant 之后的消息，将 tool 提前，intervening 挪后
}
```

### 6.2. 场景矩阵

| 场景 | 补入行为 | Step 4 行为 | 正确性 |
|------|---------|-------------|--------|
| **全部 tool_call 是孤儿 + 无 intervening** | 合成 tool 消息连续插入 assistant 之后 | `expectedIds` 在扫描开始时即清零，`intervening` 为空 → 条件不满足 → 不重排 | ✅ 无需重排，tool 已在正确位置 |
| **全部 tool_call 是孤儿 + 有 intervening** | 合成 tool 消息插入后，intervening 消息在它们之后 | 扫描找到合成 tool（匹配）→ 收集 intervening → 找到所有合成 tool 后清零 → 重排：tool 提前，intervening 挪后 | ✅ |
| **部分配对 + 有 intervening** | 孤儿 tool_call 的合成 tool 补在 assistant 之后（在原 real tool 之前） | 扫描：合成 tool（匹配）→ intervening（收集）→ real tool（匹配）→ 清零 → 重排 | ✅ |
| **所有 tool_calls 都有配对 + 有 intervening** | 不补入任何消息（changed=false 时 skip Step 4 前的 user 合并逻辑，但 Step 4 仍会执行） | Step 4 按原有逻辑执行，与旧行为完全一致 | ✅ |

### 6.3. scanLimit 边界

```
scanLimit = idx + 1 + expectedIds.size * 2 + 3
```

补策略下 `expectedIds.size` 比删策略更大（保留了所有 tool_call ID），导致 `scanLimit` 可能略大。但扫描在 `expectedIds.size === 0` 时 `break`，更大的 limit 不影响正确性，只会在极端情况下多扫描几个非 tool 消息。

**Verdict**: ✅ Step 4 在所有场景下均正确。补入→重排的时序无竞态。

---

## 7. Step 5/6 移除的集成影响

### Step 5: 空壳 assistant 清理

**移除原因**：旧行为中删除孤儿 tool_call 后，如果 assistant 的所有 tool_call 都是孤儿，会通过 `delete msg.tool_calls` 移除整个 tool_calls 字段，然后空壳 assistant（无 tool_calls + 无 content）被清理。新行为中 tool_calls **从不删除**，故不会产生空壳 assistant。

**回归风险验证**：
- 旧 Step 5 的移除条件：`!m.tool_calls && (content 为空)` → 专为"刚删除完 tool_calls 的 assistant"设计
- 旧代码已 guard `if (m.tool_calls) continue` → 不会删除有 tool_calls 的 assistant
- 新代码不会触发此条件（tool_calls 始终存在）→ 无回归
- **预存在的空壳 assistant**（非本函数制造）：旧代码也不会清理（`if (m.tool_calls) continue` 排除了它们），新旧行为一致

### Step 6: reasoning_content 填充

**移除原因**：已由 `patchMissingReasoningContent()`（在 `patch-thinking.ts` 中）覆盖，且执行顺序在 orphan patch 之前。

**交叉验证**：
- `patchMissingReasoningContent` 条件：`body.thinking || body.reasoning` 已设置
- 旧 Step 6 条件：无条件执行
- 旧 Step 6 缺少前置条件检查 → 旧行为可能在不该补的场景也补了空字符串
- 新行为更严谨：只有 thinking 激活时才补

**Verdict**: ✅ Step 5/6 移除无回归风险。

---

## 8. 测试集成验证

### 测试文件 (`router/tests/patch.test.ts`)

测试全部更新以匹配新行为：

| 旧测试 | 新测试 | 变更说明 |
|--------|--------|----------|
| "移除非末尾 assistant 中无对应 tool 消息的 tool_call 条目" | "为非末尾 assistant 的孤儿 tool_call 补入合成 tool 消息" | 测试期望值从"空壳清理"改为"合成 tool 插入" |
| "部分配对时只移除未配对的 tool_call" | "部分配对时为未配对的 tool_call 补入合成 tool 消息" | 期望值从 1 个 tool_call 改为 2 个 tool_call + 合成消息 |
| "Step 4: 部分 tool 消息匹配时不重排" | "Step 4: 部分 tool 消息匹配时补入合成消息后重排" | 期望值从"不重排"改为"补入后重排" |
| "空壳 assistant 被移除后连续 user 合并" | "assistant 的 tool_calls 保留，不再有空壳清理" | 期望值从"合并"改为"保留+补入" |

全部测试与 `patchOrphanToolResultsOA` 的新行为一致。

### 集成测试

`applyProviderPatches` 集成测试（含 `patch.test.ts` 末尾的 describe("applyProviderPatches")）未修改，仍通过。DeepSeek provider 的 orphan tool 删除功能在正向逻辑不变的情况下继续工作。

**Verdict**: ✅ 测试覆盖了正向和反向的所有行为变化。

---

## 总结

| 检查维度 | 结论 |
|---------|------|
| `patchOrphanToolResultsOA` 调用方签名不变 | ✅ 无影响 |
| `applyProviderPatches` 下游不依赖消息结构 | ✅ 无影响 |
| `needsDeepSeekPatch` 语义未变 | ✅ opcode.ai 移除不属本分支 |
| Anthropic `patchOrphanToolResults` 零改动 | ✅ 无影响 |
| `patchThinkingConsistency` 零改动 | ✅ 先于 orphan patch 执行，无冲突 |
| Step 4 与补入策略交互正确 | ✅ 所有场景验证通过 |
| Step 5/6 移除无回归 | ✅ 功能已被替代或无需 |
| 测试与行为一致 | ✅ |

**verdict: pass** — 零 MUST FIX。变更的集成面覆盖完整，无断裂的接口合约或隐藏的后置条件依赖。

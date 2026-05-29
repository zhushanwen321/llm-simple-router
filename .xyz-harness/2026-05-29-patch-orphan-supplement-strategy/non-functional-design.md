---
verdict: pass
---

# 非功能性设计 — patch-orphan-supplement-strategy

## 1. 稳定性

改动集中在单个函数的内部逻辑替换，不影响 Anthropic 版本（`patchOrphanToolResults`）或其他 patch 函数。正向删除逻辑和 Step 4 重排逻辑保持不变，风险可控。合成 tool 消息的固定 content 确保行为确定性——不会因输入不同产生不同输出。

## 2. 数据一致性

不涉及 DB 变更。消息链修改是请求级的（in-memory），不持久化。每次请求独立处理，无状态累积。Tool Call Cache（FR-3）被推迟，避免了引入跨请求状态的复杂度。

## 3. 性能

补策略相比删策略多了一次 `splice` 插入操作（O(n) 数组移动），但 n = 孤儿 tool_call 数量，实际场景中通常 ≤ 5。对请求延迟影响可忽略（< 0.1ms）。Step 5/6 的移除减少了遍历次数，整体性能略有提升。

## 4. 业务安全

合成 tool 消息的 content 为固定字符串 `"[context truncated]"`，不会泄露敏感信息或注入指令。补入的消息会被上游 provider（DeepSeek）正常处理，不会触发异常行为。

## 5. 数据安全

不涉及敏感数据处理。补入的 tool_call_id 来自客户端请求中的已有数据，不引入新的 PII。`needsDeepSeekPatch` 中移除 opencode.ai 匹配是权限收窄（减少不必要的 patch 触发），提升安全性。

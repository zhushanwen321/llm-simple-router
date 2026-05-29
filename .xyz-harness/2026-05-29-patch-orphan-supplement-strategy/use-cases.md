---
verdict: pass
---

# 业务用例 — patch-orphan-supplement-strategy

## UC-1: Claude Code compact 后的请求通过路由器

- **Actor:** Claude Code 客户端（通过路由器访问 DeepSeek）
- **Preconditions:** 路由器已配置 ds-flash provider，Claude Code 客户端已建立长会话
- **Main Flow:**
  1. Claude Code 执行 context compact，截断消息链中部分 tool 消息
  2. Claude Code 发送后续请求到路由器，消息链包含 assistant(tool_calls=[A,B]) 但只有 tool(A)
  3. 路由器的 DeepSeek patch 检测到 tool_call B 为孤儿
  4. 路由器在 assistant 后插入合成 tool 消息 `{role:"tool", tool_call_id:"B", content:"[context truncated]"}`
  5. 路由器转发修复后的请求到 DeepSeek
  6. DeepSeek 接受请求并正常响应（200 OK）
- **Alternative Paths:**
  - 如果消息链无配对断裂 → patch 不做任何修改，直接转发
  - 如果 forward 场景（有 tool 消息无 tool_calls）→ 删除孤儿 tool 消息
- **Postconditions:** DeepSeek 不返回 400 错误，Claude Code 用户无感知
- **Module Boundaries:** `patchOrphanToolResultsOA` → `needsDeepSeekPatch` → proxy handler

## UC-2: Failover 跨 provider 后的消息链兼容

- **Actor:** 路由器的 failover 机制
- **Preconditions:** ds-flash 不可用，failover 到 kimi-for-coding
- **Main Flow:**
  1. ds-flash 返回 5xx 错误，resilience layer 触发 failover
  2. 消息链携带 ds-flash 的 tool_calls 格式发送到 kimi-for-coding
  3. kimi-for-coding 要求 tool_calls 后紧跟 tool 消息
  4. patch 检测并修复配对断裂，补入合成 tool 消息
  5. kimi-for-coding 接受请求
- **Alternative Paths:**
  - 如果 failover 目标不需要 patch → `needsDeepSeekPatch` 返回 false，跳过
- **Postconditions:** Failover 成功，用户请求得到响应
- **Module Boundaries:** resilience layer → provider selection → `needsDeepSeekPatch` → `patchOrphanToolResultsOA`

## UC 覆盖映射

| UC | 覆盖的 Spec AC |
|----|---------------|
| UC-1 | AC-1, AC-5, AC-7, AC-10 |
| UC-2 | AC-1, AC-2, AC-4 |

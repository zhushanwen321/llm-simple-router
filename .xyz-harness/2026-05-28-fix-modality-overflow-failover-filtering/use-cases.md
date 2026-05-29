---
verdict: pass
---

# Use Cases — modality-overflow-failover-filtering

## UC-1: 含图片请求避免无效 failover

- **Actor:** LLM 客户端（Cursor、Continue 等）
- **Preconditions:**
  - 映射组配置了多个 targets，其中部分不支持图片
  - multimodal_fallback 已配置（可选）
- **Main Flow:**
  1. 客户端发送含图片的请求到 Router
  2. Router 检测到图片模态
  3. Router 过滤掉不支持图片的 targets
  4. 如有剩余 targets → 路由到第一个支持图片的 target
  5. 如全部被过滤且有 fallback → 路由到 fallback target
  6. 如全部被过滤且无 fallback → 立即返回 400 错误
- **Alternative Paths:**
  - 4a. 路由到的 target 失败 → failover 到下一个支持图片的 target（不会回退到不支持的）
  - 5a. fallback target 也失败 → 立即返回错误（不尝试已过滤的原始 targets）
  - 6a. 客户端收到错误 → 知道是模态不支持问题（而非模糊的上游错误）
- **Postconditions:**
  - 每次请求只尝试支持当前模态的 targets
  - 不存在"尝试必然失败的 target → 浪费 API 调用"的链路
- **Module Boundaries:** modality-redirect.ts（过滤逻辑）→ failover-loop.ts（消费过滤后列表）
- **AC 覆盖:** AC-1, AC-2, AC-3, AC-4, AC-5

## UC-2: 管理员排查无效重试

- **Actor:** 系统管理员
- **Preconditions:**
  - 管理员在 Admin UI 的日志页面查看请求日志
  - 之前有含图片的请求经过 Router
- **Main Flow:**
  1. 管理员打开请求日志页面
  2. 找到含图片的请求记录
  3. 查看 pipeline_snapshot 字段
  4. 看到 modality-redirect 阶段的 reason 清晰记录了过滤行为
  5. 看到 failover 链路中只包含支持图片的 targets（或零次尝试 + 提前报错）
- **Alternative Paths:**
  - 4a. reason = `filtered-ineligible-targets` → 部分过滤
  - 4b. reason = `replaced-with-fallback` → 完全替换
  - 4c. reason = `no-eligible-targets` → 提前报错
- **Postconditions:**
  - 管理员能通过日志明确判断 modality 过滤是否生效
  - 不再出现"fallback 失败 → 原始模型失败"的诡异链路
- **Module Boundaries:** PipelineSnapshot（记录 reason）→ request_logs（持久化）→ Admin UI（展示）
- **AC 覆盖:** AC-1, AC-2, AC-3（通过 snapshot reason 验证）

## UC ↔ AC 覆盖映射表

| UC | AC |
|----|-----|
| UC-1 | AC-1, AC-2, AC-3, AC-4, AC-5 |
| UC-2 | AC-1, AC-2, AC-3 |
| **未覆盖 AC** | AC-6, AC-7, AC-8, AC-9 |
| **说明** | AC-6/7 是"不触发"场景（非业务用例），AC-8 是技术性叠加验证，AC-9 是回归保证 |

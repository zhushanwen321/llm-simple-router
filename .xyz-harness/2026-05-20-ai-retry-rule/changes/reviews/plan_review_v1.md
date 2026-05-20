---
review:
  type: plan_review
  round: 1
  timestamp: "2026-05-20T22:30:00"
  target: ".xyz-harness/2026-05-20-ai-retry-rule/plan.md"
  verdict: fail
  summary: "计划评审第1轮，6条MUST FIX，已修复，等待第2轮确认"
statistics:
  total_issues: 13
  must_fix: 6
  must_fix_resolved: 6
  low: 5
  info: 2

issues:
  - id: 1
    severity: MUST_FIX
    location: "plan.md > Task 2 > Step 4"
    title: "retry-routes options — encryption_key 获取路径"
    status: resolved
    resolved_in_round: 1
    fix: "删除了不确定性注释，确认 getSetting(db, 'encryption_key') 是项目通用模式（providers.ts:179、failover-loop.ts:184），在关键实现注意事项中明确说明"

  - id: 2
    severity: MUST_FIX
    location: "plan.md > Task 2 > Step 3"
    title: "proxy-enhancement PUT schema 扩展设计"
    status: resolved
    resolved_in_round: 1
    fix: "补充了 Type.Optional 的向后兼容说明；handler 中先解构 ai_retry_config 再写入 proxy_enhancement JSON，两个 settings key 独立存储"

  - id: 3
    severity: MUST_FIX
    location: "plan.md > Task 2 > tests"
    title: "集成测试 Provider 加密 setup"
    status: resolved
    resolved_in_round: 1
    fix: "测试注意中明确说明：先 setSetting(db, 'encryption_key', ...)，再用 encrypt('test-api-key', encKey) 生成正确加密值"

  - id: 4
    severity: MUST_FIX
    location: "plan.md > Task 3 > Step 2"
    title: "ProviderGroup 类型不匹配"
    status: resolved
    resolved_in_round: 1
    fix: "将 { groupKey, label, items } 改为实际类型 { provider: { id, name }, models: [{ name, contextWindow, streamTimeoutMs }] }，参考 ModelMappings.vue 实现"

  - id: 5
    severity: MUST_FIX
    location: "plan.md > Task 2 > Step 4"
    title: "错误响应格式不一致"
    status: resolved
    resolved_in_round: 1
    fix: "统一所有业务错误为 HTTP 200 + { success: false, error }，删除 reply.code(400/404/500/502) 调用。测试也统一检查 statusCode=200"

  - id: 6
    severity: MUST_FIX
    location: "plan.md > Task 2 > extractResponseText"
    title: "stream_text_content 未过滤 TEXT 部分"
    status: resolved
    resolved_in_round: 1
    fix: "确认 stream_text_content 存储的是 serializeBlocksForStorage 序列化后的标准 API 响应格式（不是 SSE 原始格式），序列化时已过滤非 text blocks。extractResponseText 直接使用即可"

  - id: 7
    severity: LOW
    location: "plan.md > Task 4"
    title: "行数风险"
    status: open
    resolved_in_round: null

  - id: 8
    severity: LOW
    location: "plan.md > Task 2 > validateAIRule"
    title: "函数签名复杂"
    status: open
    resolved_in_round: null

  - id: 9
    severity: LOW
    location: "plan.md > Task 4 > handleGenerateRule"
    title: "logId 取值逻辑"
    status: open
    resolved_in_round: null

  - id: 10
    severity: LOW
    location: "plan.md > FG1 > File Structure"
    title: "遗漏 i18n 文件"
    status: resolved
    resolved_in_round: 1
    fix: "在 File Structure 表格中增加了 6 个 i18n JSON 文件条目"

  - id: 11
    severity: LOW
    location: "plan.md > Task 1"
    title: "不支持代理"
    status: open
    resolved_in_round: null

  - id: 12
    severity: INFO
    location: "plan.md > Task 1"
    title: "URL 解析"
    status: open
    resolved_in_round: null

  - id: 13
    severity: INFO
    location: "plan.md > File Structure"
    title: "文件列表不完整"
    status: resolved
    resolved_in_round: 1
    fix: "已补充 i18n JSON 文件"
---

# 计划评审 v1 — 修复摘要

## 6 条 MUST FIX 修复确认

| # | 问题 | 修复内容 |
|---|------|---------|
| 1 | encryption_key 路径 | 删除"需要确认"注释，明确 `getSetting(db, "encryption_key")` 是确认实现路径 |
| 2 | Schema 扩展 | 补充 Type.Optional 说明 + handler 分离存储逻辑 |
| 3 | 测试加密 | 用 `setSetting + encrypt()` 模式替换硬编码假值 |
| 4 | ProviderGroup 类型 | 从 `{ groupKey, label, items }` 改为实际类型 `{ provider, models }` |
| 5 | 错误格式 | 所有业务错误走 200 + `{ success: false, error }` |
| 6 | stream_text_content | 确认存储格式为序列化 JSON 非原始 SSE，extractResponseText 正确 |

**结论：** 6 条 MUST FIX 已全部修复。请复审。

# E2E 测试计划：图片模型自动切换（分层路由模型）

## 测试环境

| 项 | 配置 |
|----|------|
| 后端 | `buildApp({ config, db: initDatabase(":memory:") })` + `app.inject()` |
| 前端 | 手动验证 |
| Mock 上游 | `http.createServer()` 模拟 OpenAI/Anthropic 响应 |
| 认证 | Admin JWT + Router API key |

## 测试组 & 依赖图

```
TG1 (Capabilities) ──┬── TG3 (E2E 分层路由) ── TG4 (边界/异常)
TG2 (配置写入)    ───┘

TG5 (前端) ── TG1 + TG2
```

---

## TG1：Capabilities 基础设施

### TC1.1 已知模型自动匹配 capabilities
**操作**：创建 provider，models 含 `gpt-4o`（白名单中）→ GET
**验证**：API 返回 capabilities 含 `["text", "image"]`，DB JSON 同步

### TC1.2 未知模型默认 text-only
**操作**：创建 provider，models 含 `my-model`（不在白名单）→ GET
**验证**：API 返回 capabilities 为 `["text"]`

### TC1.3 手动覆盖 capabilities
**操作**：PUT 更新 provider 的 `my-model` capabilities 为 `["text", "image"]` → GET
**验证**：API + DB 均反映更新的 capabilities

---

## TG2：配置写入

### TC2.1 创建映射组含 image_fallback
**操作**：POST `/admin/api/mapping-groups`，rule 含 `image_fallback` → GET
**验证**：201，返回的 rule JSON 含 image_fallback；DB 同步

### TC2.2 validateRule 拒绝无效 provider_id
**操作**：POST 含不存在的 `image_fallback.provider_id`
**验证**：400，错误消息提示 provider 不存在

### TC2.3 validateRule 拒绝 inactive provider
**操作**：创建 provider 后设 inactive → POST 含该 provider_id
**验证**：400，错误消息提示 provider 不可用

### TC2.4 向后兼容：无 image_fallback 正常创建
**操作**：POST 不含 `image_fallback`
**验证**：201

---

## TG3：端到端分层路由

**前置**：
- Provider A：`text-model`（capabilities: `["text"]`），active
- Provider B：`vision-model`（capabilities: `["text", "image"]`），active
- Mapping group：`my-model → text-model @ A`，image_fallback: `{ provider_id: B, backend_model: vision-model }`
- Mock B 返回 200

### TC3.1 OpenAI 格式 — 含图片自动切换
**操作**：POST `/v1/chat/completions`，content 数组含 `type: "image_url"`
**验证**：

| 层 | 断言 |
|----|------|
| API | 200，响应来自 Provider B |
| DB | `request_logs` upstream_provider_id = B, upstream_model = `vision-model` |

### TC3.2 Anthropic 格式 — 含图片自动切换
**操作**：POST `/v1/messages`，content 含 `type: "image"`
**验证**：

| 层 | 断言 |
|----|------|
| API | 200，转发到 Provider B |
| DB | upstream_provider_id = B, upstream_model = `vision-model` |

### TC3.3 Responses API 格式 — 含图片自动切换
**操作**：POST `/v1/responses`，input 含 `type: "input_image"`
**验证**：

| 层 | 断言 |
|----|------|
| API | 200，转发到 Provider B |
| DB | upstream_provider_id = B, upstream_model = `vision-model` |

### TC3.4 纯文本不触发切换
**操作**：POST `/v1/chat/completions`，content 为 string
**验证**：请求转发到 Provider A，upstream_model = `text-model`

### TC3.5 模型已支持图片不切换
**操作**：A 的 model 改为 `gpt-4o`（capabilities 含 image），含图片请求
**验证**：请求转发到 Provider A（已支持图片）

### TC3.6 分层路由：IR + OF 正确展开
**前置**：A 的 target 配置 overflow → `text-model-128k @ A`
**操作**：含图片请求
**验证**：IR 层 prepend B 的 fallback → OF 层为 A 展开 overflow → target 列表 `[vision-model@B, text-model-128k@A, text-model@A]`

---

## TG4：边界 & 异常

### TC4.1 无 image_fallback + 含图片 → 不切换
**验证**：请求转发到原始 provider（no-op）

### TC4.2 fallback provider 不存在 → 不切换
**验证**：IR 层不扩展，请求转发到原始 provider

### TC4.3 fallback provider inactive → 不切换
**验证**：IR 层不扩展

### TC4.4 IR 层异常降级 → 不阻塞请求
**操作**：构造异常（如 mock `getMappingGroup` 抛错）
**验证**：IR 层返回原列表，请求正常完成

### TC4.5 StageRecord 记录
**验证**：request_log 的 metadata 含 `image-redirect` stage 记录

### TC4.6 failover 不重复选择已失败的 IR target（无死循环）
**前置**：B 的 vision-model 固定返回 500
**操作**：含图片请求
**验证**：IR 层 prepend B → orchestrator 用 B 失败 → exclude B → 下一迭代从原始列表选 A → A 也失败 → 请求返回错误。总迭代数 ≤ 2（不浪费到 10）

---

## TG5：前端手动验证

### TC5.1 Provider 页 — 查看/编辑 capabilities
**验证**：gpt-4o 显示 text + image badge；可勾选/取消；保存后更新

### TC5.2 映射组页 — 配置 image_fallback
**验证**：显示 image_fallback 配置区域（选择 provider + 输入 model）；保存后验证 API 请求含正确字段

### TC5.3 映射组页 — 验证错误提示
**操作**：填写不存在 provider_id → 保存
**验证**：toast 显示后端错误消息

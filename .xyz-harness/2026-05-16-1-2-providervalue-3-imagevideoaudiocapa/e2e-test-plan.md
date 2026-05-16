# E2E 测试计划：多模态重定向（Modality Redirect）

## 测试环境

- 后端：`buildApp({ config, db: in-memory })` + `app.inject()` 模拟 HTTP
- 前端：无 E2E 框架，通过 API 测试 + 手动页面验证
- 数据：SQLite 内存库，每测试组独立初始化

## 测试组

### TG1: detectModalities() 纯函数���试

**依赖**：无
**范围**：AC1-AC6

| ID | 用例 | 输入 | 期望输出 | 验证层 |
|----|------|------|----------|--------|
| TG1-1 | OpenAI image_url | `{ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "..." } }] }] }` | Set 含 `"image"` | API |
| TG1-2 | Anthropic image | `{ messages: [{ role: "user", content: [{ type: "image", source: { type: "base64" } }] }] }` | Set 含 `"image"` | API |
| TG1-3 | Anthropic tool_result 内嵌 image | `{ messages: [{ role: "user", content: [{ type: "tool_result", content: [{ type: "image", source: { type: "base64" } }] }] }] }` | Set 含 `"image"` | API |
| TG1-4 | Responses API input_image | `{ input: [{ type: "input_image", image_url: "..." }] }` | Set 含 `"image"` | API |
| TG1-5 | OpenAI input_audio | `{ messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: "..." } }] }] }` | Set 含 `"audio"` | API |
| TG1-6 | Responses API input_audio | `{ input: [{ type: "input_audio", input_audio: { data: "..." } }] }` | Set 含 `"audio"` | API |
| TG1-7 | Responses API message.content input_image | `{ input: [{ type: "message", role: "user", content: [{ type: "input_image", image_url: "..." }] }] }` | Set 含 `"image"` | API |
| TG1-8 | 空 body | `{}` | 空 Set | API |
| TG1-9 | 空 messages | `{ messages: [] }` | 空 Set | API |
| TG1-10 | 混合 image + audio | `{ messages: [{ role: "user", content: [{ type: "image_url" }, { type: "input_audio" }] }] }` | Set 含 `"image"` 和 `"audio"` | API |

### TG2: computeModalityRedirectTargets() 决策测试

**依赖**：TG1 通过
**范围**：AC7-AC15

**数据准备**（每个用例前执行）：
1. `const db = initDatabase(":memory:")` + `seedSettings(db)`
2. 插入首 target provider：`insertProvider(db, { id: "main", name: "Main", models: JSON.stringify([{ name: "text-model", capabilities: ["text"] }]), is_active: 1 })`
3. 如需 image-capable provider：`insertProvider(db, { id: "vision", name: "Vision", models: JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]), is_active: 1 })`
4. 插入 mapping group：`insertMappingGroup(db, "client-model", JSON.stringify({ targets: [{ provider_id: "main", backend_model: "text-model" }], multimodal_fallback: { provider_id: "vision", backend_model: "vision-model" } }))`
5. 构造 `const snapshot = new PipelineSnapshot()`
6. 调用 `computeModalityRedirectTargets(db, targets, "client-model", body, snapshot)`

| ID | 用例 | 前置条件 | 期望结果 | 验证层 |
|----|------|----------|----------|--------|
| TG2-1 | 首 target 支持所有模态 | 首 target capabilities 含 image+audio；body 含 image+audio | 不 redirect，reason `"first-target-supports-all-modalities"` | API+DB(snapshot) |
| TG2-2 | 首 target 不支持 image | 首 target 仅 text；body 含 image；配置了 multimodal_fallback | redirect 到 fallback，reason `"first-target-lacks-modality"` | API+DB(snapshot) |
| TG2-3 | 无 multimodal_fallback 配置 | 首 target 仅 text；body 含 image；rule 无 fallback | 不 redirect，reason `"no-multimodal-fallback-configured"` | API+DB(snapshot) |
| TG2-4 | fallback 缺失模态（新增） | 首 target 仅 text；body 含 image+audio；fallback 仅支持 image | 不 redirect，reason `"fallback-missing-modality"` | API+DB(snapshot) |
| TG2-5 | fallback 支持所有模态（新增） | 首 target 仅 text；body 含 image+audio；fallback 支持 image+audio | redirect 到 fallback | API+DB(snapshot) |
| TG2-6 | fallback provider inactive | fallback provider is_active=0 | 不 redirect，reason `"fallback-provider-unavailable"` | API+DB(snapshot) |
| TG2-7 | 无 mapping group | clientModel 无对应 mapping group | 不 redirect，reason `"no-mapping-group"` | API+DB(snapshot) |
| TG2-8 | rule 解析失败 | group.rule 为非法 JSON | 不 redirect，reason `"rule-parse-error"` | API+DB(snapshot) |
| TG2-9 | 内部异常 | 注入异常 | 返回原始 targets，reason `"internal-error"` | API |

### TG3: Pipeline Snapshot 集成测试

**依赖**：TG2 通过
**范围**：AC16

| ID | 用例 | 期望 snapshot 内容 | 验证层 |
|----|------|-------------------|--------|
| TG3-1 | redirect 触发时 | `{ stage: "modality-redirect", triggered: true, detected_modalities: ["image"], reason: "first-target-lacks-modality" }` | DB(snapshot JSON) |
| TG3-2 | redirect 未触发时 | `{ stage: "modality-redirect", triggered: false, reason: "no-multimodal-detected" }` | DB(snapshot JSON) |
| TG3-3 | 无旧 stage 名 | snapshot JSON 中不含 `"image-redirect"` | DB(grep) |

### TG4: Admin API 校验测试

**依赖**：无
**范围**：AC17

**数据准备**：
1. `const app = await buildApp({ db: initDatabase(":memory:") })`
2. `const cookie = await login(app)` — 获取 JWT cookie
3. 插入 active provider：`POST /admin/api/providers` + cookie
4. 插入 inactive provider（TG4-5 用）：`POST /admin/api/providers` + 手动设 `is_active=0`

**请求格式**：`app.inject({ method: "POST", url: "/admin/api/groups", headers: { cookie }, payload: { strategy: "scheduled", rule: JSON.stringify(ruleObj) } })`

| ID | 用例 | rule payload | 期望响应 | 验证层 |
|----|------|-------------|----------|--------|
| TG4-1 | 有效 multimodal_fallback | `{ targets: [{ provider_id: "active-p", backend_model: "m1" }], multimodal_fallback: { provider_id: "active-p", backend_model: "m1" } }` | 200；DB: `SELECT rule FROM mapping_groups` → JSON 含 `multimodal_fallback` | API+DB |
| TG4-2 | 缺 provider_id | `{ targets: [...], multimodal_fallback: { backend_model: "m1" } }` | 400，body 含 `"multimodal_fallback"` | API |
| TG4-3 | 缺 backend_model | `{ targets: [...], multimodal_fallback: { provider_id: "active-p" } }` | 400，body 含 `"multimodal_fallback"` | API |
| TG4-4 | provider 不存在 | `{ targets: [...], multimodal_fallback: { provider_id: "nonexistent", backend_model: "m1" } }` | 400，body 含 `"multimodal_fallback"` | API |
| TG4-5 | provider inactive | `{ targets: [...], multimodal_fallback: { provider_id: "inactive-p", backend_model: "m1" } }` | 400，body 含 `"multimodal_fallback"` | API |
| TG4-6 | 旧字段名无效 | `{ targets: [...], image_fallback: { provider_id: "active-p", backend_model: "m1" } }` | 200（`image_fallback` 不被识别为 fallback，等同于无 fallback 配置） | API |
| TG4-7 | 无 fallback 字段 | `{ targets: [{ provider_id: "active-p", backend_model: "m1" }] }` | 200（向后兼容） | API |

### TG5: Failover Loop 集成测试

**依赖**：TG2 通过
**范围**：AC16 回归

**数据准备**：
1. 创建 mock backend server（`http.createServer` 随机端口）
2. `buildApp({ db })` 注册完整 Fastify 应用
3. 插入 provider + mapping group（含 `multimodal_fallback`）
4. 插入 router_key 用于认证

| ID | 用例 | 场景 | 期望 | 验证层 |
|----|------|------|------|--------|
| TG5-1 | image redirect 完整流程 | text-only target + image body + multimodal_fallback | fallback target 被尝试，snapshot 含 modality-redirect stage | API+DB |
| TG5-2 | 多轮 failover + modality | 首 target 500 + fallback 200 | 最终 200，pipeline_snapshot 记录完整链路 | API+DB |

### TG6: 前端 UI 验证（手动）

**依赖**：TG1-TG5 全部通过 + 前端构建完成
**范围**：AC18, AC19

| ID | 用例 | 操作步骤 | 期望 | 验证层 |
|----|------|----------|------|--------|
| TG6-1 | Alert 警告显示 | ModelMappings → 编辑映射组 → 添加 multimodal fallback | fallback 配置下方出现琥珀色警告框，含"会话将持续路由"文字 | DOM+Visual |
| TG6-2 | Alert 不显示 | ModelMappings → 编辑映射组 → 不添加 fallback | 无警告框 | DOM |
| TG6-3 | capabilities checkbox | Providers → 编辑模型 → 查看 capabilities 区域 | 显示 text badge + image/audio/video 三个 checkbox | DOM |
| TG6-4 | 切换 audio | 点击 audio checkbox | capabilities 数组增/删 `"audio"` | API+DOM |
| TG6-5 | 旧引用清理 | 全局搜索 `imageFallback` | 前端源码零匹配 | grep |

### TG7: 旧引用清理验证

**依赖**：所有任务完成
**范围**：AC21

| ID | 用例 | 命令 | 期望 |
|----|------|------|------|
| TG7-1 | 后端旧引用 | `grep -rn "image-redirect\|image_fallback\|hasImage\|supportsImage\|computeImageRedirect" router/src/ router/tests/ --include="*.ts"` | 零匹配 |
| TG7-2 | 前端旧引用 | `grep -rn "ImageFallback\|toggleModelImageCapability\|toggle-image-capability" frontend/src/ --include="*.ts" --include="*.vue"` | 零匹配 |

## 执行顺序

```
TG1 (detectModalities) ──→ TG2 (computeModalityRedirectTargets) ──→ TG3 (snapshot)
                                    ↓
TG4 (admin 校验) ─────────────────────────────────────────────→ TG5 (failover 集成)
                                    ↓
                                TG6 (前端手动)
                                    ↓
                                TG7 (旧引用 grep)
```

TG1、TG4 可并行。TG5 依赖 TG2+TG4。TG6 依赖全部自动化测试通过。TG7 最后执行。

## 验证策略

| 层级 | 使用场景 | 工具 |
|------|----------|------|
| API | 所有后端逻辑 | `app.inject()` + 断言 status/body | 
| DB | pipeline snapshot、request log | 查询 `request_logs` 表的 `pipeline_snapshot` 字段 |
| DOM | 前端组件存在性 | 手动页面检查 |
| Visual | Alert 样式 | 手动确认琥珀色警告框 |
| grep | 旧引用清理 | `grep -rn` 命令 |

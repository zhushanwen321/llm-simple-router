---
e2e_plan: .xyz-harness/2026-05-16-modality-redirect/e2e-test-plan.md
review_round: 1
verdict: need_revision
must_fix_count: 4
date: 2026-05-16
---

# E2E 测试计划评审 v1

## 评审记录

- 评审时间：2026-05-16
- 评审类型：E2E 测试计划独立评审
- 评审对象：e2e-test-plan.md
- 评审轮次：第 1 轮

## Summary

E2E 测试计划结构清晰，7 个测试组覆盖了 spec 的全部 21 条 AC，依赖 DAG 无循环，执行顺序合理。但存在 4 条 MUST FIX：缺少 Responses API 两条检测路径的测试用例、测试数据准备步骤未具象化、Admin API 测试缺少可直接执行的请求细节、TG4-1 数据写入缺少 DB 验证。

## Spec AC 覆盖矩阵

| AC | 描述 | 覆盖状态 | 测试用例 |
|----|------|---------|----------|
| AC1 | detectModalities OpenAI image_url | ✅ 完整 | TG1-1 |
| AC2 | detectModalities Anthropic image (含 tool_result) | ✅ 完整 | TG1-2, TG1-3 |
| AC3 | detectModalities Responses API input_image | ⚠️ 部分 | TG1-4（仅 `input[]` 级别，缺 `message.content[]` 级别） |
| AC4 | detectModalities OpenAI input_audio | ⚠️ 部分 | TG1-5（仅 OpenAI 格式，缺 Responses API `input_audio`） |
| AC5 | detectModalities 空 body/空 messages | ✅ 完整 | TG1-6, TG1-7 |
| AC6 | detectModalities 混合 image+audio | ✅ 完整 | TG1-8 |
| AC7 | 首 target 支持所有模态 → 不 redirect | ✅ 完整 | TG2-1 |
| AC8 | 首 target 不支持 image → redirect | ✅ 完整 | TG2-2 |
| AC9 | 无 multimodal_fallback → 不 redirect | ✅ 完整 | TG2-3 |
| AC10 | fallback 缺失模态 → 不 redirect | ✅ 完整 | TG2-4 |
| AC11 | fallback 支持所有模态 → redirect | ✅ 完整 | TG2-5 |
| AC12 | fallback provider inactive → 不 redirect | ✅ 完整 | TG2-6 |
| AC13 | 无 mapping group → 不 redirect | ✅ 完整 | TG2-7 |
| AC14 | rule 解析失败 → 不 redirect | ✅ 完整 | TG2-8 |
| AC15 | 内部异常 → 返回原始 targets | ✅ 完整 | TG2-9 |
| AC16 | pipeline snapshot stage 名 + detected_modalities | ✅ 完整 | TG3-1, TG3-2, TG3-3 |
| AC17 | admin multimodal_fallback 校验 | ✅ 完整 | TG4-1 ~ TG4-7 |
| AC18 | 前端 Alert 警告显示 | ✅ 完整 | TG6-1, TG6-2 |
| AC19 | 前端 capabilities 切换泛化 | ✅ 完整 | TG6-3, TG6-4 |
| AC20 | 全部测试通过 | ✅ 隐含 | 全测试组执行通过 |
| AC21 | 旧引用清理 | ✅ 完整 | TG7-1, TG7-2 |

**覆盖缺口**：AC3 和 AC4 的 Responses API 检测路径未完整覆盖（见 Issues #1）。

## 四层策略合理性

| 用例组 | 验证层级 | 场景 | 评估 |
|--------|---------|------|------|
| TG1 | L1 (API/函数调用) | 纯函数单元测试 | ✅ 合理 — 纯函数无 DB/DOM 副作用 |
| TG2 | L1+L4 (API+DB snapshot) | 决策逻辑 + snapshot 记录 | ✅ 合理 |
| TG3 | L4 (DB snapshot JSON) | snapshot 字段内容验证 | ✅ 合理 — 函数正确性已在 TG2 验证 |
| TG4 | L1 (API) | Admin API 校验 | ⚠️ TG4-1 数据写入缺 L4 |
| TG5 | L1+L4 (API+DB) | Failover 集成 | ✅ 合理 |
| TG6 | L2+L3 (DOM+Visual) | 前端手动验证 | ✅ 合理 |
| TG7 | grep | 旧引用清理 | ✅ 合理 |

## 发现的问题

### MUST FIX

| # | 优先级 | 维度 | 位置 | 描述 | 修改建议 |
|---|--------|------|------|------|---------|
| 1 | MUST FIX | spec AC 覆盖 | TG1 | **Responses API 检测路径不完整**。spec 检测规则定义了 Responses API 的 3 条检测路径：`input[]` 的 `input_image`（TG1-4 覆盖）、`input[]` 的 `input_audio`（未覆盖）、`message.content[]` 的 `input_image`（未覆盖）。TG1-5 仅测试 OpenAI 格式 `input_audio`，TG1-4 仅测试 `input[]` 级别。 | 新增 2 个用例：(a) TG1-9: Responses API `input_audio` in `input[]` → Set 含 `"audio"`；(b) TG1-10: Responses API `input_image` in `message.content[]` → Set 含 `"image"`。输入示例：`{ input: [{ type: "message", role: "user", content: [{ type: "input_image", image_url: "..." }] }] }` |
| 2 | MUST FIX | 步骤可执行性 | TG2, TG4, TG5 | **测试数据准备步骤缺失**。TG2（computeModalityRedirectTargets）需要：插入指定 capabilities 的 provider、创建 mapping group（含 multimodal_fallback rule）。TG4 需要：创建 active/inactive provider、获取 JWT cookie。TG5 需要：完整的 provider + mapping group + mock backend。计划仅描述了"前置条件"的语义，未给出具体的 DB 初始化命令或 helper 调用。项目已有 `insertProvider()`、`insertMappingGroup()`、`buildApp()`、`login()` 等 helper（见 `image-redirect.test.ts` 和 `admin-groups-validation.test.ts`）。 | 为 TG2/TG4/TG5 各增加"数据准备"小节，列出具体步骤：(1) `initDatabase(":memory:")` + `seedSettings(db)`；(2) `insertProvider(db, { id, name, models, is_active })`（含 models JSON 的 capabilities 字段）；(3) `insertMappingGroup(db, clientModel, rule)`；(4) `buildApp({ config, db })` + `login(app)`。参考现有测试文件的 helper 模式。 |
| 3 | MUST FIX | 步骤可执行性 | TG4 | **Admin API 测试缺少可直接执行的请求细节**。TG4 的 7 个用例仅列出了请求 body 片段，缺少：(a) HTTP method（应为 PUT/PATCH 更新 group 的 rule 字段，或 POST 创建新 group）；(b) endpoint URL（如 `/admin/api/groups/:id` 或 `/admin/api/groups`）；(c) 认证 header（JWT cookie 格式）；(d) 完整 payload 结构（`targets` 数组需要具体值）。执行 agent 无法直接复制执行。 | 补充完整的请求格式。参考现有测试模式：`app.inject({ method: "PUT", url: "/admin/api/groups/{id}", headers: { cookie }, payload: { strategy: "scheduled", rule: JSON.stringify({...}) } })`。TG4-1 的完整 payload 应为：`{ strategy: "scheduled", rule: JSON.stringify({ targets: [{ backend_model: "text-model", provider_id: "{activeProviderId}" }], multimodal_fallback: { provider_id: "{fallbackProviderId}", backend_model: "vision-model" } }) }` |
| 4 | MUST FIX | 四层策略 | TG4-1 | **数据写入用例缺少 L4（DB）验证**。TG4-1 创建含 `multimodal_fallback` 的有效 group，返回 200。但仅验证了 HTTP 状态码，未验证 `multimodal_fallback` 数据是否正确持久化到 `mapping_groups` 表的 `rule` JSON 字段中。 | TG4-1 增加 DB 验证步骤：`SELECT rule FROM mapping_groups WHERE id = ?` → 解析 JSON → 断言 `multimodal_fallback.provider_id` 和 `multimodal_fallback.backend_model` 与请求一致。 |

### LOW

| # | 优先级 | 维度 | 位置 | 描述 | 修改建议 |
|---|--------|------|------|------|---------|
| 5 | LOW | 用例质量 | 全局 | 严重程度未标注。所有用例未标注阻塞/重要/一般级别。 | 建议为每个用例标注：TG2-2/TG2-4/TG2-5（核心 redirect 逻辑）为阻塞，TG1-6/TG1-7（边界条件）为一般，其余为重要。 |
| 6 | LOW | 用例质量 | TG2 | TG2 共 9 个用例，超过建议上限 8 个。 | 可将 TG2 拆为 TG2a（正常路径 AC7-AC11）和 TG2b（异常路径 AC12-AC15），但非必须。 |
| 7 | LOW | 步骤可执行性 | TG6 | 前端手动测试的页面操作步骤较模糊（如 "ModelMappings → 编辑映射组 → 添加 multimodal fallback"）。但鉴于前端测试为手动执行，LOW 即可。 | 可补充具体的 URL 路径（如 `http://localhost:5173/admin/mappings`）和交互步骤（点击哪个按钮、填写哪个字段）。 |

### INFO

| # | 优先级 | 维度 | 位置 | 描述 |
|---|--------|------|------|------|
| 8 | INFO | 依赖关系 | TG5 | TG5 依赖 TG4 的必要性可商榷。TG5 测试 failover 集成，数据通过 DB 直接插入，不经过 admin API。保守依赖无危害，仅增加串行等待。 |

## 依赖关系检查

执行顺序为严格串行 DAG：

```
TG1 (纯函数) ──→ TG2 (决策逻辑) ──→ TG3 (snapshot)
                         ↓
TG4 (admin 校验) ─────────────→ TG5 (failover 集成)
                                       ↓
                                  TG6 (前端手动)
                                       ↓
                                  TG7 (旧引用 grep)
```

- TG1、TG4 可并行 ✅
- TG2 依赖 TG1 ✅（detectModalities 是 computeModalityRedirectTargets 的子调用）
- TG3 依赖 TG2 ✅（snapshot 由 redirect 逻辑产生）
- TG5 依赖 TG2+TG4 ✅
- 无循环依赖 ✅
- 拓扑排序可行 ✅

## 测试环境检查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 后端启动方式 | ✅ | `buildApp({ config, db: in-memory })` + `app.inject()` |
| 前端启动方式 | ⚠️ | 计划未说明前端手动验证时的启动命令。应为 `cd frontend && npm run dev`（端口 5173，代理 /admin/api 到 :9980） |
| 数据库初始化 | ❌ | 未说明 DB 初始化步骤（MUST FIX #2 的一部分） |
| Chrome CDP 配置 | N/A | 前端测试为手动，不需要 CDP |
| 清理方式 | ✅ | 内存 DB 自动清理 |
| 认证配置 | ❌ | TG4 需要 JWT cookie，未说明获取方式（应为 `login(app)` helper） |

## 结论

**需修改后重审**

4 条 MUST FIX 未解决。核心问题是：(1) Responses API 检测路径覆盖不完整（2 条缺失用例）；(2) 集成测试的数据准备步骤未具象化，执行 agent 无法直接操作；(3) Admin API 测试请求不完整；(4) 数据写入缺 DB 验证。

修复后提交第 2 轮评审。

### Summary

E2E 测试计划评审完成，第 1 轮，4 条 MUST FIX，需修改后重审。

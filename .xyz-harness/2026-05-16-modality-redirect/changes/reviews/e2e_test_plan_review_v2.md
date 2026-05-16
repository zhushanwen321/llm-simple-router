---
e2e_plan: .xyz-harness/2026-05-16-modality-redirect/e2e-test-plan.md
review_round: 2
verdict: pass
must_fix_count: 0
date: 2026-05-16
---

# E2E 测试计划评审 v2

## 评审记录

- 评审时间：2026-05-16 19:30
- 评审类型：E2E 测试计划独立评审（v2 重审）
- 评审对象：e2e-test-plan.md
- 评审轮次：第 2 轮

## v1 MUST FIX 修复验证

| # | v1 问题 | 修复方式 | 验证结果 |
|---|---------|---------|---------|
| 1 | Responses API 缺 input_audio + message.content input_image 用例 | 新增 TG1-6（Responses API `input_audio`）和 TG1-7（Responses API `message.content[]` input_image） | ✅ 已修复 |
| 2 | TG2/TG4/TG5 数据准备步骤缺失 | 三个测试组均增加"数据准备"小节，列出具体 helper 调用 | ✅ 已修复 |
| 3 | TG4 Admin API 请求缺 method/URL/auth | 增加"请求格式"行，含完整 `app.inject()` 调用模板 | ✅ 已修复 |
| 4 | TG4-1 数据写入缺 DB 验证 | 验证层改为 API+DB，增加 `SELECT rule FROM mapping_groups` 验证 | ✅ 已修复 |

### 逐项验证详情

**Issue #1**：TG1 从 8 个用例扩展到 10 个。新增的 TG1-6 输入 `{ input: [{ type: "input_audio", input_audio: { data: "..." } }] }` 对应 spec 检测规则中 Responses API `input_audio` 路径；新增的 TG1-7 输入 `{ input: [{ type: "message", role: "user", content: [{ type: "input_image", image_url: "..." }] }] }` 对应 spec 中 `message.content[]` 级别的 `input_image` 检测。两条缺失路径已补齐，AC3 和 AC4 现在完整覆盖。

**Issue #2**：TG2 数据准备含 6 步（initDB → seedSettings → insertProvider × 2 → insertMappingGroup → PipelineSnapshot → 调用目标函数）；TG4 数据准备含 4 步（buildApp → login → insert active provider → insert inactive provider）；TG5 数据准备含 4 步（mock backend → buildApp → insert provider+group → insert router_key）。步骤可执行性达标。

**Issue #3**：TG4 增加 `app.inject({ method: "POST", url: "/admin/api/groups", headers: { cookie }, payload: { strategy: "scheduled", rule: JSON.stringify(ruleObj) } })` 模板。每个用例的 rule payload 列在表格中。认证方式（cookie from `login(app)`）在数据准备中说明。

**Issue #4**：TG4-1 期望列从 `200` 改为 `200；DB: SELECT rule FROM mapping_groups → JSON 含 multimodal_fallback`。验证层从 API 改为 API+DB。

## Spec AC 覆盖矩阵

| AC | 场景 | 覆盖状态 | 测试用例 |
|----|------|---------|----------|
| AC1 | detectModalities OpenAI image_url → Set 含 "image" | ✅ 完整 | TG1-1 |
| AC2 | detectModalities Anthropic image（含 tool_result 内嵌） | ✅ 完整 | TG1-2, TG1-3 |
| AC3 | detectModalities Responses API input_image | ✅ 完整 | TG1-4（input[] 级别）, TG1-7（message.content[] 级别） |
| AC4 | detectModalities input_audio | ✅ 完整 | TG1-5（OpenAI 格式）, TG1-6（Responses API 格式） |
| AC5 | detectModalities 空 body / 空 messages | ✅ 完整 | TG1-8, TG1-9 |
| AC6 | detectModalities 混合 image+audio | ✅ 完整 | TG1-10 |
| AC7 | 首 target 支持所有模态 → 不 redirect | ✅ 完整 | TG2-1 |
| AC8 | 首 target 不支持 image → redirect | ✅ 完整 | TG2-2 |
| AC9 | 无 multimodal_fallback → 不 redirect | ✅ 完整 | TG2-3 |
| AC10 | fallback 缺失模态 → 不 redirect（新增行为） | ✅ 完整 | TG2-4 |
| AC11 | fallback 支持所有模态 → redirect（新增行为） | ✅ 完整 | TG2-5 |
| AC12 | fallback provider inactive → 不 redirect | ✅ 完整 | TG2-6 |
| AC13 | 无 mapping group → 不 redirect | ✅ 完整 | TG2-7 |
| AC14 | rule JSON 解析失败 → 不 redirect | ✅ 完整 | TG2-8 |
| AC15 | 内部异常 → 返回原始 targets | ✅ 完整 | TG2-9 |
| AC16 | pipeline snapshot stage 名 + detected_modalities | ✅ 完整 | TG3-1（triggered=true）, TG3-2（triggered=false）, TG3-3（无旧 stage 名） |
| AC17 | admin multimodal_fallback 校验 | ✅ 完整 | TG4-1（有效）, TG4-2（缺 provider_id）, TG4-3（缺 backend_model）, TG4-4（provider 不存在）, TG4-5（provider inactive）, TG4-6（旧字段名）, TG4-7（无 fallback） |
| AC18 | 前端 Alert 警告显示 | ✅ 完整 | TG6-1, TG6-2 |
| AC19 | 前端 capabilities 切换泛化 | ✅ 完整 | TG6-3, TG6-4 |
| AC20 | 全部测试通过 | ✅ 隐含 | 全测试组执行通过 |
| AC21 | 旧引用清理 | ✅ 完整 | TG7-1（后端 grep）, TG7-2（前端 grep） |

**覆盖率**：21/21 AC 全部覆盖，无遗漏。

## 四层策略合理性

| 用例组 | 验证层级 | 场景 | 评估 |
|--------|---------|------|------|
| TG1 | L1 | 纯函数单元测试 | ✅ 合理 — 纯函数无 DB/DOM 副作用 |
| TG2 | L1+L4 | 决策逻辑 + snapshot 记录 | ✅ 合理 |
| TG3 | L4 | snapshot JSON 字段内容验证 | ✅ 合理 — 函数正确性已在 TG2 验证 |
| TG4 | L1+L4（TG4-1）/ L1（TG4-2~7） | Admin API 校验 | ✅ 合理 — 仅数据写入用例需 DB 验证 |
| TG5 | L1+L4 | Failover 集成 | ✅ 合理 |
| TG6 | L2+L3 | 前端手动验证 | ✅ 合理 — spec 标注手动验证 |
| TG7 | grep | 旧引用清理 | ✅ 合理 |

## 步骤可执行性抽查

### 抽查 1: TG1-6（新增用例）

- 输入：`{ input: [{ type: "input_audio", input_audio: { data: "..." } }] }`
- 期望：Set 含 `"audio"`
- 判定：**可直接执行** — 纯函数调用，输入输出明确 ✅

### 抽查 2: TG2-2（核心 redirect 逻辑）

- 数据准备：6 步，含 `insertProvider` + `insertMappingGroup` 具体调用
- 首条数据：provider `main` + model `text-model`（capabilities `["text"]`）
- fallback 数据：provider `vision` + model `vision-model`（capabilities `["text", "image"]`）
- mapping group rule：`{ targets: [{ provider_id: "main", backend_model: "text-model" }], multimodal_fallback: { provider_id: "vision", backend_model: "vision-model" } }`
- body 含 image → redirect 到 fallback
- 判定：**可直接执行** ✅

### 抽查 3: TG4-1（Admin API 有效 fallback）

- 请求格式：`app.inject({ method: "POST", url: "/admin/api/groups", headers: { cookie }, payload: { strategy: "scheduled", rule: JSON.stringify(ruleObj) } })`
- rule payload：`{ targets: [{ provider_id: "active-p", backend_model: "m1" }], multimodal_fallback: { provider_id: "active-p", backend_model: "m1" } }`
- 验证：200 + DB `SELECT rule FROM mapping_groups` → JSON 含 `multimodal_fallback`
- 判定：**可直接执行** ✅

### 抽查 4: TG5-1（Failover 集成）

- 数据准备：mock backend + buildApp + insert provider+group + insert router_key
- 场景：text-only target + image body + multimodal_fallback
- 验证：API（最终响应）+ DB（pipeline_snapshot 含 modality-redirect stage）
- 判定：**可执行** — 数据准备步骤引用了项目标准 helper 模式，mock backend 创建模式在现有测试中已有大量先例 ✅

### 抽查 5: TG7-1（旧引用 grep）

- 命令：`grep -rn "image-redirect\|image_fallback\|hasImage\|supportsImage\|computeImageRedirect" router/src/ router/tests/ --include="*.ts"`
- 期望：零匹配
- 判定：**可直接复制执行** ✅

## 依赖关系检查

```
TG1 (detectModalities) ──→ TG2 (computeModalityRedirectTargets) ──→ TG3 (snapshot)
                                    ↓
TG4 (admin 校验) ─────────────────────────────────────────────→ TG5 (failover 集成)
                                    ↓
                                TG6 (前端手动)
                                    ↓
                                TG7 (旧引用 grep)
```

| 检查项 | 结果 |
|--------|------|
| 依赖矩阵完整 | ✅ 每个测试组标注了前置依赖 |
| 拓扑排序可行 | ✅ 无循环依赖 |
| 前置条件明确 | ✅ TG1 无依赖，TG2 依赖 TG1，TG3 依赖 TG2，TG4 无依赖，TG5 依赖 TG2+TG4，TG6 依赖全部，TG7 最后 |
| 执行顺序与依赖一致 | ✅ TG1/TG4 可并行，后续按依赖串行 |

## 测试环境检查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 后端启动方式 | ✅ | `buildApp({ config, db: in-memory })` + `app.inject()` |
| 前端启动方式 | ⚠️ | 计划未说明前端手动验证时的启动命令，应为 `cd frontend && npm run dev`。LOW — TG6 为手动执行 |
| 数据库初始化 | ✅ | TG2/TG4/TG5 各有数据准备步骤，含 `initDatabase(":memory:")` |
| 认证配置 | ✅ | TG4 数据准备含 `const cookie = await login(app)` |
| Chrome CDP 配置 | N/A | 前端测试为手动，不需要 CDP |
| 清理方式 | ✅ | 内存 DB 自动清理 |

## 发现的问题

### MUST FIX

无。

### LOW

| # | 优先级 | 维度 | 位置 | 描述 | 修改建议 |
|---|--------|------|------|------|---------|
| 1 | LOW | 步骤可执行性 | TG5 | 数据准备步骤相对 TG2 偏高层描述。TG2 列出了具体 `insertProvider()` 字段值，TG5 仅说"插入 provider + mapping group"。测试 executor 需参考 TG2 模式自行构造。 | 可补充具体的 provider insert 语句（含 mock backend URL 作为 base_url）。但 TG5 是集成测试，executor 参考项目已有测试模式即可执行。 |
| 2 | LOW | 用例质量 | 全局 | 严重程度未标注。沿用 v1 问题。 | 为核心用例（TG2-2/TG2-4/TG2-5）标注"阻塞"，边界用例（TG1-8/TG1-9）标注"一般"。 |
| 3 | LOW | 步骤可执行性 | TG6 | 前端手动测试步骤较模糊。沿用 v1 问题。 | 可补充 URL 路径（`http://localhost:5173/admin/mappings`）和具体交互步骤。 |

## 结论

**通过**

v1 的 4 条 MUST FIX 全部修复到位：(1) Responses API 检测路径补齐 2 个用例；(2) 数据准备步骤具象化；(3) Admin API 请求格式完整；(4) TG4-1 增加 DB 验证。无新 MUST FIX。3 条 LOW 为延续 v1 的建议性改进，不阻塞。

### Summary

E2E 测试计划评审完成，第 2 轮，0 条 MUST FIX，通过。

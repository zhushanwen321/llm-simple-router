# Code Review v1 — 图片模型自动切换

**日期**: 2026-05-16
**分支**: feat-image-model-switch
**评审范围**: 39 files changed, 6401 insertions(+), 210 deletions(-)
**评审模式**: 编码评审

## 执行证据

### 质量门禁（实际运行）

```
$ cd router && npx tsc --noEmit
TSC_EXIT=0

$ cd router && npx vitest run
 Test Files  115 passed (115)
    Tests  1392 passed (1392)
 Start at  08:57:19
 Duration  23.03s

$ cd router && npx eslint . --max-warnings=0
ESLINT_EXIT=0
```

### 变更统计

```
$ git diff origin/main...HEAD --stat
 router/src/admin/groups.ts                         |  39 +-
 router/src/config/model-context.ts                 |  85 ++-
 router/src/proxy/handler/failover-loop.ts          | 207 +++---
 router/src/proxy/pipeline-snapshot.ts              |   7 +-
 router/src/proxy/routing/image-redirect.ts         | 203 +++++++
 router/src/proxy/routing/overflow.ts               |  25 +
 router/tests/admin-groups-validation.test.ts       | 302 ++++++++
 router/tests/expand-overflow.test.ts               | 104 ++++
 router/tests/failover-loop-layered.test.ts         | 574 ++++++++++++
 router/tests/image-redirect.test.ts                | 673 ++++++++++++++
 router/tests/model-capabilities.test.ts            | 126 ++++
 router/tests/model-context.test.ts                 |  26 +-
 router/tests/pipeline-snapshot.test.ts             |  77 ++-
 (plus frontend changes and harness docs)
```

## 评审结论：PASS（0 条阻塞问题，1 条 LOW）

---

## 逐文件审查

### 1. router/src/config/model-context.ts（+85 行）

变更内容：`ModelEntry`/`ModelInfo` 新增 `capabilities?: string[]`；新增 `MODEL_CAPABILITIES` 白名单（74 个模型条目）；`parseModels()` 三层回退补充。

实际代码审查（L96-169 MODEL_CAPABILITIES）：
- 白名单包含 OpenAI/Anthropic/DeepSeek/智谱/月之暗面等厂商模型
- spec 只列了中国厂商模型，实现额外加了 OpenAI/Anthropic/DeepSeek 系列模型
- 这与 spec 白名单原则一致（只列出确认支持图片的模型），属于合理扩展

parseModels() 变更（L219-233）：
- `obj.capabilities ?? MODEL_CAPABILITIES[modelName] ?? ["text"]` — 优先级正确
- 字符串格式旧模型（L219-221）也能正确补充 capabilities
- buildModelInfoList()（L257）正确传递 capabilities

判定：无问题。

### 2. router/src/proxy/routing/image-redirect.ts（新文件，+203 行）

变更内容：IR 层纯函数 `computeImageRedirectTargets()` + 图片检测 `hasImage()`。

代码审查要点：
- hasImage() 检测三种格式：OpenAI `image_url`、Anthropic `image`、Responses API `input_image`（含顶层和嵌套两种）
- computeImageRedirectTargets() 分支链：空列表→无图片→已支持→无 group→无 fallback→provider 不存在→provider inactive→prepend
- 每个分支记录 StageRecord（含 triggered + reason）
- 外层 try-catch 保证异常安全（返回原 targets）
- fallback target 只含 `{provider_id, backend_model}`，不含 overflow 字段

判定：无问题。实现与 spec §3 完全一致。

### 3. router/src/proxy/routing/overflow.ts（+25 行）

变更内容：新增 `expandOverflowTargets()` 包装函数。

代码审查（L120-143）：
- 遍历 targets，per-target 调用 `applyOverflowRedirect()`
- 有结果时 prepend overflow target
- per-target try-catch，单个失败不阻塞其他
- L134 有 `eslint-disable-next-line taste/no-silent-catch` 注释，catch 块内有 console.error

判定：无问题。

### 4. router/src/proxy/pipeline-snapshot.ts（+7 行）

变更内容：StageRecord union 新增 `"image-redirect"` 变体。

代码审查（L6）：
```typescript
| { stage: "image-redirect"; triggered: boolean; original_model: string; redirect_to: string; redirect_provider: string; reason: string }
```
字段与 spec §4 完全一致。discriminated union 新增变体不影响已有消费者。

判定：无问题。

### 5. router/src/proxy/handler/failover-loop.ts（重构，207 行变更）

这是本次最关键的变更。实际审查 diff 确认：

**import 变更**（L21-22）：
```typescript
import { expandOverflowTargets } from "../routing/overflow.js";
import { computeImageRedirectTargets } from "../routing/image-redirect.js";
```
移除了 `applyOverflowRedirect` 导入（不再在循环内使用）。

**循环外预计算**（从 diff 确认的变更）：
- `resolveMapping()` 移到 while 外，只调一次
- `allowed_models` 检查移到 while 外，在 IR 层之前
- `computeImageRedirectTargets()` — IR 层
- `expandOverflowTargets()` — OF 层
- `cachedTargets = allTargets` — 预计算结果缓存

**while(true) 循环体**：
- `filterExcluded(cachedTargets, excludeTargets)` — 选第一个非 excluded
- `getProviderById()` + active 检查 — provider 不存在/inactive 直接返回错误（非 exclude+continue）
- 格式转换、plugin adjustments、provider patches — 不变
- `orchestrator.handle()` — 不变
- 失败时 `excludeTargets.push(resolved); continue`

**关键行为约束验证**：
- allowed_models 检查在 IR 层之前 — 符合 spec
- provider inactive 返回错误而非 exclude+continue — 符合 spec
- 循环内无 resolveMapping/overflow 调用 — 符合 spec AC20

判定：无问题。核心重构正确。

### 6. router/src/admin/groups.ts（+39 行）

变更内容：validateRule() 扩展 image_fallback 校验。

代码审查（L83-102）：
- `fallback !== undefined && fallback !== null` — 向后兼容
- `fb.provider_id` / `fb.backend_model` 非空检查
- `getProviderById()` 存在性检查
- `!fbProvider.is_active` active 状态检查
- 错误消息明确

判定：无问题。

### 7. frontend/src/views/Providers.vue

变更内容：模型列表增加 capabilities Badge + Checkbox 编辑。

代码审查：
- 使用 shadcn-vue Badge 组件展示 image capability
- 使用 Checkbox 组件切换 image 能力
- `toggleModelImageCapability()` 正确修改 capabilities 数组
- API 错误处理 `toast.error()` + `console.error()` — 符合前端错误处理规范

**LOW 问题**：使用原生 `<label>` 而非 shadcn-vue `<Label>` 组件。不影响功能，但违反项目规范。

### 8. frontend/src/views/ModelMappings.vue + ModelMappingCard.vue

变更内容：映射组编辑增加 image_fallback 配置区域。

代码审查：
- 使用 shadcn-vue Select/Input/Button 组件
- `buildEntries()` 正确从 rule JSON 提取 image_fallback
- 保存时正确序列化 image_fallback 到 rule JSON
- `Promise.allSettled` 并行加载 — 符合项目规范
- 错误处理 `toast.error()` + `console.error()` — 符合前端错误处理规范

判定：无问题。

---

## Spec AC 覆盖矩阵

| AC# | 描述 | 覆盖方式 |
|-----|------|---------|
| AC1-AC4 | IR 层各分支 | image-redirect.test.ts (16 tests) |
| AC5-AC6 | capabilities 解析 | model-capabilities.test.ts (8 tests) |
| AC7-AC8 | fallback provider 校验 | image-redirect.test.ts |
| AC9 | StageRecord | image-redirect.test.ts |
| AC10 | 异常降级 | image-redirect.test.ts |
| AC11 | Provider UI | Providers.vue 已实现 |
| AC12 | 映射组 UI | ModelMappings.vue 已实现 |
| AC13-AC16 | 图片格式检测 | image-redirect.test.ts |
| AC17 | validateRule | admin-groups-validation.test.ts (8 tests) |
| AC18-AC19 | 分层路由集成 | failover-loop-layered.test.ts (5 tests) |
| AC20 | 循环简化 | 代码审查确认（循环内无 resolveMapping/overflow 调用） |

20/20 AC 覆盖。

---

## 问题清单

| # | 级别 | 文件 | 位置 | 描述 |
|---|------|------|------|------|
| 1 | LOW | Providers.vue | 约 L202 | 使用原生 `<label>` 而非 shadcn-vue `<Label>` |

0 条阻塞问题。1 条 LOW 不影响功能。

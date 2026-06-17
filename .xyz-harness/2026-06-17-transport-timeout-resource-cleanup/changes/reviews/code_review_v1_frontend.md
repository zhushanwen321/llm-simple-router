---
verdict: fail
must_fix: 1
---

# Code Review v1 — Frontend（non_stream_timeout_ms 贯通 + ModelCard UI）

**分支**: fix-concurrency-reduct
**审查范围**: 前端 13 文件 diff（uncommitted，HEAD 之上）
**审查日期**: 2026-06-17
**审查人**: code-review skill

## 自动化基线

| 检查 | 命令 | 结果 |
|------|------|------|
| 类型检查 | `cd frontend && npx vue-tsc -b --noEmit` | ✅ 0 error |
| ESLint | `npx eslint <13 files> --max-warnings=0` | ✅ 0 error 0 warning |
| 模板行数 | ModelCard.vue template | 220 行（≤800） |
| 脚本行数 | ModelCard.vue script setup | 116 行（≤600） |
| `<style>` 块 | ModelCard.vue | 无（仅 Tailwind class，无 @apply 违规可能） |

## 维度审查

### 1. 类型安全 — ✅ PASS

`non_stream_timeout_ms` 的类型注解在每个定义点都与既有 `stream_timeout_ms` 对称：

| 文件 | 字段 | 类型 |
|------|------|------|
| `types/mapping.ts:27` | `ModelInfo.non_stream_timeout_ms` | `number \| null`（与 `stream_timeout_ms` 一致） |
| `components/quick-setup/types.ts:44` | `ModelConfig.non_stream_timeout_ms` | `number`（与 `stream_timeout_ms` 一致） |
| `components/mappings/cascading-types.ts:7` | `ModelOption.nonStreamTimeoutMs` | `number \| null`（一致） |
| `components/quick-setup/ModelCard.vue:37` | props `nonStreamTimeoutMs` | `number`（一致） |

无 `any`，无类型断言滥用。`vue-tsc` 零错误。

### 2. 字段贯通完整性 — ✅ PASS

逐节点比对 `stream_timeout_ms` 与 `non_stream_timeout_ms` 的对称性（grep 全量核对）：

| 数据流节点 | 文件 | stream | non-stream |
|------------|------|:-----:|:----------:|
| 类型定义 | types/mapping.ts | ✓ | ✓ |
| 类型定义 | quick-setup/types.ts | ✓ | ✓ |
| 类型定义 | cascading-types.ts | ✓ | ✓ |
| 新增模型默认值 | ModelCapabilitiesEditor.vue:102-103 | ✓ | ✓ |
| 新增模型默认值 | quick-setup-actions.ts:297-298 | ✓ | ✓ |
| 新增模型默认值 | quick-setup-helpers.ts:375-376 | ✓ | ✓ |
| 新增模型默认值 | useProviderForm.ts:242-243 | ✓ | ✓ |
| 序列化 payload | quick-setup-helpers.ts:151-152 | ✓ | ✓ |
| 序列化 payload | useProviderForm.ts:206-207 | ✓ | ✓ |
| 加载 provider | useProviderForm.ts:336-337 | ✓ | ✓ |
| ModelGroups 转换 | useProviderGroups.ts:43-44 | ✓ | ✓ |
| 视图绑定 | QuickSetup.vue:272-273 | ✓ | ✓ |
| 事件绑定 | QuickSetup.vue:276, 278-280 | ✓ | ✓ |
| 事件绑定 | ModelCapabilitiesEditor.vue:303-304, 307-309 | ✓ | ✓ |
| 更新 handler | quick-setup-actions.ts:401-404 | ✓ | ✓ |
| 更新 handler | useProviderForm.ts:272-281 | ✓ | ✓ |
| 更新 handler | ModelCapabilitiesEditor.vue:138-146 | ✓ | ✓ |

**13 个 `stream_timeout_ms` 出现点全部对称加了 `non_stream_timeout_ms`，无遗漏。**

### 3. 默认值一致性 — ✅ PASS

`frontend/src/constants.ts`:
```ts
export const DEFAULT_STREAM_TIMEOUT_MS = 300_000;      // 5 分钟（原 30_000）
export const DEFAULT_NON_STREAM_TIMEOUT_MS = 600_000;  // 10 分钟
```

后端 `router/src/db/providers.ts:33-37`:
```ts
export const DEFAULT_STREAM_TIMEOUT_MS = 300_000;
export const DEFAULT_NON_STREAM_TIMEOUT_MS = 600_000;
```

前后端默认值**完全对齐**。`30_000 → 300_000` 的修改实际是修复前端长期偏离后端的 stale 默认值（前端原本展示 30s，后端实际用 300s）—— 这是一个正向修复，不是 bug。

语义清晰且前后端一致：
- `0` → 后端 `resolveTimeout` 返回 `Infinity`（禁用）
- `undefined/null` → 后端用默认值
- `> 0` → 自定义 ms

### 4. UI 规范 — ⚠️ 见 MUST FIX #1

| 规范项 | 结果 |
|--------|------|
| shadcn-vue `<Input>` / `<Badge>` | ✅ 无原生 `<input>` |
| lucide 图标 `Clock` | ✅ 无 Emoji |
| `<style scoped>` 仅 @apply | ✅ 无 `<style>` 块 |
| 模板行数 ≤800 | ✅ 220 行 |
| 脚本行数 ≤600 | ✅ 116 行 |
| Badge 逻辑优先级 | ✅ `v-if="isDisabled"` 先于 `v-else-if="isDefault"` |
| **"0=禁用"端到端可用性** | ❌ **见 MUST FIX #1** |

注：ModelCard 第 ~135 行的内联 `<svg>` 勾选标记是**既有代码**（启用态 checkbox），非本次 diff 引入，不计入本次审查。

### 5. i18n 完整性 — ✅ PASS

`en/quickSetup.json` 与 `zh-CN/quickSetup.json` 同步新增 3 个 key：

| key | en | zh-CN |
|-----|----|-------|
| `patch.streamTimeoutLabel` | "Stream timeout (s)" | "流式超时（秒）" |
| `patch.nonStreamTimeoutLabel` | "Non-stream timeout (s)" | "非流式超时（秒）" |
| `patch.disabled` | "Disabled" | "禁用" |

复用的 `providers.fields.timeoutPlaceholder`（"默认"语义）已存在于既有 i18n，无需新增。

### 6. 模板/脚本行数 — ✅ PASS

ModelCard.vue 总 337 行：script 116 行 / template 220 行，均远低于上限。

### 7. 表单校验（zod）— ℹ️ INFO（非违规）

超时输入未接入 zod/vee-validate，但 QuickSetup 全文件原本就不使用 zod（所有内联 Input 都是显式 transform 模式）。本次新增的 `min="0"` HTML 属性提供基础客户端防护，与既有约定一致。**不视为违规**——强行加 zod 反而会破坏文件内部的一致性。

---

## MUST FIX

### #1 [error] "0 = 禁用" UI 端到端断裂，`isDisabledXxxTimeout` Badge 为死代码

**文件**:
- `frontend/src/composables/quick-setup-actions.ts:106`（`setModelTimeout`）
- `frontend/src/composables/useProviderForm.ts:279-281`（`updateModelNonStreamTimeout`）
- `frontend/src/components/providers/ModelCapabilitiesEditor.vue:141-146`（`updateModelNonStreamTimeout`）

**现象**: 本次 PR 在 ModelCard 新增了"禁用"语义的 UI：
- `min="0"`（原 `min="1"`，允许输入 0）
- `isDisabledStreamTimeout` / `isDisabledNonStreamTimeout` computed（`=== 0`）
- "Disabled" Badge（`v-if="isDisabledXxxTimeout"`）

但三层 parent handler 都会把 `0` 归一化掉，导致用户输入 `0` 永远无法落到存储层：

```ts
// quick-setup-actions.ts:106
const patch: Partial<ModelConfig> = { [field]: ms || undefined };
//                                                       ^^^^^^^^^^
// ms = 0 → 0 || undefined → undefined  （"禁用"语义丢失）

// ModelCapabilitiesEditor.vue:145（与既有 stream 的 pattern 一致）
non_stream_timeout_ms: ms && ms > 0 ? ms : null,
//                     ^^^^^^^^^^^^^
// ms = 0 → 0 && ... → null  （"禁用"语义丢失）

// useProviderForm.ts:279-281
form.value.models[index].non_stream_timeout_ms =
  val > 0 ? val * MS_PER_SECOND : null;
//  ^^^^^                              ^^^^
//  val = 0 → null  （"禁用"语义丢失）
```

**数据流追踪**（用户在 QuickSetup 页面输入 "0" 试图禁用）：

1. ModelCard Input 收到 "0" → `$event ? Number($event) * 1000 : undefined` → `"0"` truthy → emit `0`
2. `QuickSetup.vue` → `updateModelNonStreamTimeout(i, 0)`
3. `setModelTimeout(..., "non_stream_timeout_ms", 0)` → `{ non_stream_timeout_ms: 0 || undefined }` → `undefined`
4. `modelConfigs[i].non_stream_timeout_ms = undefined`
5. 回传 ModelCard：`:non-stream-timeout-ms="undefined ?? undefined"` → `undefined`
6. `isDisabledNonStreamTimeout = (undefined === 0)` → **`false`**
7. `isDefaultNonStreamTimeout = (undefined === undefined)` → **`true`**
8. UI 显示 **"Default" Badge，而不是 "Disabled"**，输入框跳回 600（默认值）

**用户感知**：输入 0 → 输入框闪一下跳回 600 + 显示"默认"。既无法禁用，也无任何反馈。`isDisabledXxxTimeout` 这个 computed 在正常交互下**永远不可能为 true**，是死代码。

**根因**：ModelCard 的 emit 契约（允许 `0`）与 parent 的存储契约（剥离 `0`）不一致。后端 `resolveTimeout` 明确支持 `0 → Infinity`，但 UI 数据流没有把这个语义贯通到存储层。

**修复方案**（二选一）：

**方案 A（推荐，长期方案）**：让 parent 保留 `0`，真正贯通"禁用"语义。

```ts
// quick-setup-actions.ts — ms 已经是 number | undefined，直接透传
const patch: Partial<ModelConfig> = { [field]: ms };

// ModelCapabilitiesEditor.vue — 只把 undefined 归一化为 null，保留 0
non_stream_timeout_ms: ms === undefined ? null : ms,
stream_timeout_ms: ms === undefined ? null : ms,  // 同步修 stream（既有一致性 bug）

// useProviderForm.ts — 保留 0
form.value.models[index].non_stream_timeout_ms =
  seconds === "" || seconds === undefined ? null : val * MS_PER_SECOND;
```

**方案 B（短期方案）**：如果"禁用"不是这次 PR 想要的能力，回退 UI：
- `min="0"` → `min="1"`
- 删除 `isDisabledStreamTimeout` / `isDisabledNonStreamTimeout` computed
- 删除两个 "Disabled" Badge

**推荐方案 A**，理由：
1. 后端 `resolveTimeout(value, fallback)` 已经实现了 `0 → Infinity` 语义，前端 UI 已经画好了对应的 Badge 和 `min="0"`，只差存储层贯通这一步
2. 方案 B 等于删功能，而 `non_stream_timeout_ms` 这个新字段最大的用户价值之一就是"非流式请求可以完全关闭超时"（大模型长推理场景）
3. 修复成本极小（3 处一行改动），且能顺带修掉既有 `stream_timeout_ms` 的同类问题（`ms && ms > 0 ? ms : null` 这段 pattern 是从 stream 复制过来的，stream 一直有同样的隐藏 bug，只是原 UI 没暴露）

**附加注意**：ModelCard 第 226/271 行的 emit 三元 `$event ? Number($event) * MS_PER_SECOND : undefined` 对 `$event` 类型敏感——若 shadcn-vue Input 的 `@update:model-value` 在某些场景返回数值 `0`（而非字符串 `"0"`），`0 ? ... : undefined` 会直接走 `undefined` 分支。方案 A 修复 parent 后此处仍然脆弱，建议同步改为：

```ts
@update:model-value="
  emit(
    'update:non-stream-timeout-ms',
    $event === '' || $event === null || $event === undefined
      ? undefined
      : Number($event) * MS_PER_SECOND,
  )
"
```

---

## WARNING / INFO（非阻塞）

### W1 [warning] `setModelTimeout` 与 `updateModelNonStreamTimeout` 存储语义不一致

QuickSetup 链路用 `undefined` 表示"未设置"，Providers 页面（ModelCapabilitiesEditor / useProviderForm）用 `null` 表示"未设置"。两者在 JSON 序列化时都消失，功能等价，但类型层面 `ModelConfig.non_stream_timeout_ms?: number`（不接受 null）与 `ModelInfo.non_stream_timeout_ms?: number | null`（接受 null）的差异需要开发者留意。**本次 PR 沿用了既有 pattern，非新引入问题**，可在后续清理时统一。

### I1 [info] 超时输入无上限校验

用户可输入极大值（如 999999999）。后端会照单全收设为大超时，无崩溃风险。既有 stream 输入同样无上限，保持一致即可，非本次必须处理。

### I2 [info] Clock 图标颜色区分

stream 用 `text-muted-foreground/70`，non-stream 用 `/40`，提供微妙视觉区分。无功能影响，设计选择合理。

---

## 通过项汇总

- ✅ 类型安全（`vue-tsc` 0 error，无 `any`）
- ✅ 字段贯通完整（13/13 节点对称）
- ✅ 默认值前后端对齐（300_000 / 600_000）
- ✅ shadcn-vue 组件、lucide 图标、无 Emoji
- ✅ 无 `<style>` 块，Tailwind class 合规
- ✅ i18n 中英文齐全
- ✅ 模板/脚本行数远低于上限
- ✅ ESLint 0 error 0 warning

## 结论

**verdict: fail**，**must_fix: 1**。

唯一阻塞项是 MUST FIX #1："0 = 禁用"的 UI 端到端断裂。本次 PR 在 ModelCard 新增了 disabled Badge 和 `min="0"`，宣示了"禁用超时"能力，但 parent handler（`setModelTimeout` / `updateModelNonStreamTimeout`）的 `ms || undefined` / `ms && ms > 0 ? ms : null` 归一化把 `0` 剥离成 `undefined`/`null`，导致该能力在正常用户交互下完全不可达，`isDisabledXxxTimeout` 成为死代码。

修复成本：3 处一行改动（方案 A）。修复后既贯通本次新字段，也顺带修掉既有 `stream_timeout_ms` 的同类隐藏 bug。建议合并前修复。

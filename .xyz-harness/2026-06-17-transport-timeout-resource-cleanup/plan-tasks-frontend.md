---
verdict: pass
---

# 前端任务详情 — Transport 超时配置 UI

> non_stream_timeout_ms 字段贯通 11 文件 + ModelCard 主行双超时输入框。前后端通过 `providers.models` JSON 解耦。

## Task 9: non_stream_timeout_ms 字段贯通

**Type:** frontend **Group:** FG1

**Files（11 个）：**
- Modify: `frontend/src/constants.ts`（DEFAULT_STREAM_TIMEOUT_MS 30000→300000；加 DEFAULT_NON_STREAM_TIMEOUT_MS=600000）
- Modify: `frontend/src/types/mapping.ts`（ModelConfig 加 `non_stream_timeout_ms?: number | null`）
- Modify: `frontend/src/components/quick-setup/types.ts`（ModelConfig 加字段）
- Modify: `frontend/src/components/mappings/cascading-types.ts`（关联类型加字段）
- Modify: `frontend/src/composables/useProviderForm.ts`（4 处：读取 m.stream_timeout_ms 旁加 non、handleAddModel 默认值、updateModelNonStreamTimeout、序列化）
- Modify: `frontend/src/composables/quick-setup-actions.ts`（2 处：L280 默认值、L296 赋值）
- Modify: `frontend/src/composables/quick-setup-helpers.ts`（2 处：L151、L374）
- Modify: `frontend/src/composables/useProviderGroups.ts`（L43 读取处加 non）
- Modify: `frontend/src/views/QuickSetup.vue`（透传）

**关键改动模式（每处对称）：**
凡现有出现 `stream_timeout_ms` 的读取/赋值/默认/序列化点，**正下方**增加 `non_stream_timeout_ms` 的对称处理，默认值用 `DEFAULT_NON_STREAM_TIMEOUT_MS`。

参考现有 `stream_timeout_ms` 处理（如 `useProviderForm.ts:202/237/268`）：
- 读取：`stream_timeout_ms: m.stream_timeout_ms ?? undefined` → 加 `non_stream_timeout_ms: m.non_stream_timeout_ms ?? undefined`
- 默认：`stream_timeout_ms: DEFAULT_STREAM_TIMEOUT_MS` → 加 `non_stream_timeout_ms: DEFAULT_NON_STREAM_TIMEOUT_MS`
- 赋值函数：复制 `updateModelStreamTimeout` 为 `updateModelNonStreamTimeout`。

**验证命令：**
```bash
cd frontend && npx vue-tsc -b --noEmit && npx eslint . --max-warnings=0
```
Expected: 0 error 0 warning。

---

## Task 10: ModelCard 主行双超时输入框 UI

**Type:** frontend **Group:** FG1 **Depends:** 9

**Files:**
- Modify: `frontend/src/components/quick-setup/ModelCard.vue`（主行加双 Input + 移除补丁区单超时输入框）
- Modify: `frontend/src/components/providers/ModelCapabilitiesEditor.vue`（接 nonStreamTimeoutMs prop + emit；3 处镜像点：L98 handleAddModel 默认值、L131 updateModelStreamTimeout 旁加 updateModelNonStreamTimeout、L289 ModelCard 调用处传 prop+emit）
- Modify: `frontend/src/components/quick-setup/ModelCard.vue`（i18n 文案 + 0 值"禁用"显示）

**关键改动（ModelCard.vue）：**

1. props 加 `nonStreamTimeoutMs?: number`；emit 加 `"update:non-stream-timeout-ms": [value: number | undefined]`。
2. `displayTimeoutSeconds` 同理加 `displayNonStreamTimeoutSeconds` computed。
3. 主行布局：在补丁按钮**左侧**插入两个 Input（复用现有超时 Input 的样式 `h-6 w-[60px] !text-[11px] font-mono text-right`），每个配小 label（流式/非流式，或用 tooltip + 图标）。

**主行结构（形式 A，平铺）：**
```
[勾选] [模型名] [上下文] [能力×4] [流式超时Input][非流式Input] [补丁] [删除]
```
响应式：窄屏（< 768px）两个超时 Input 可缩小至 w-[48px]，模型名 `min-w` 降低；若仍拥挤，超时组 `flex-shrink-0` + 模型名 `truncate`。

4. 移除 `<Collapsible>` 内的单一 Timeout 区块（streamTimeoutMs 那段，约 L225-247）。

**ModelCapabilitiesEditor.vue：**
- `ModelCard` 调用处加 `:non-stream-timeout-ms="m.non_stream_timeout_ms ?? undefined"` 和 `@update:non-stream-timeout-ms="updateModelNonStreamTimeout(i, $event)"`。
- 新增 `updateModelNonStreamTimeout(index, ms)` 函数（复制 `updateModelStreamTimeout` 逻辑）。

**0 值显示（AC-7）：** Input 显示 `0` 时，旁标 Badge 文案"禁用"（复用现有 `isDefaultTimeout` Badge 逻辑，改为判断 `=== 0` 显示"禁用"，`undefined` 显示默认值标记）。

**i18n：** `quickSetup.patch.streamTimeoutLabel` / `nonStreamTimeoutLabel` / `disabled` 等文案（中英文）。

**验证：**
```bash
cd frontend && npx vue-tsc -b --noEmit && npm run build
```
手动验证：模型编辑页主行可见双超时输入框，默认 300/600，改值后保存重载保留，输入 0 显示"禁用"。

**镜像点核对（ModelCapabilitiesEditor.vue）：** L98 `handleAddModel` 默认值、L131 `updateModelStreamTimeout`（复制为 nonStream 版）、L289 `ModelCard` 调用 props/emit —— 三处同步加 non_stream_timeout_ms。

**vue_rules_checker.py 注意：**
- 主行 Input 用 `@/components/ui/input` 的 `<Input>`，禁止原生 `<input>`。
- 无 Emoji，用 lucide 图标（可选 Clock 图标作超时标识）。
- `<style scoped>` 仅 `@apply`。

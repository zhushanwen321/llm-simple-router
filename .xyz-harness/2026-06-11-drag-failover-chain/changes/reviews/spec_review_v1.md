---
review:
  type: spec_review
  round: 1
  timestamp: "2026-06-11T11:00:00"
  target: ".xyz-harness/2026-06-11-drag-failover-chain/spec.md"
  verdict: fail (已修复 → 待重审)
  summary: "Spec 评审 v1：覆盖度好、AC 可测性强，但 2 条 MUST FIX（mousedown.stop 阻断 dragstart 的机制错误 + FR-4.1 缺少'不持久化'反向 AC）+ 3 条 RECOMMENDED。"

statistics:
  total_issues: 5
  must_fix: 2
  must_fix_resolved: 2
  low: 3
  info: 0

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md:FR-1.4"
    title: "@mousedown.stop 阻断 dragstart 的机制错误"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 1
    resolution: "改用 @dragstart.stop.prevent 显式拦截浏览器原生 dragstart 事件，AC-6/AC-7 同步更新"
  - id: 2
    severity: MUST_FIX
    location: "spec.md:FR-4.1"
    title: "缺少'不自动持久化'的反向 AC"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 1
    resolution: "新增 AC-12（拖拽后不触发 API）和 AC-13（跨容器拖拽为 no-op）"
  - id: 3
    severity: LOW
    location: "spec.md:实现要点 §1 行为表"
    title: "moveItem 行为表覆盖不完整（缺首→末、末→首双向）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 4
    severity: LOW
    location: "spec.md:Constraints"
    title: "图标库名 'lucide-vue-next' 与项目实际 '@lucide/vue' 不一致"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 1
    resolution: "已改为 '@lucide/vue'"
  - id: 5
    severity: LOW
    location: "spec.md:FR-5.2 / FR-5.3"
    title: "Out of Scope 项（触屏、跨容器、多选）无对应反向 AC"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# Spec Review v1 — 故障转移链拖拽重排

## 评审记录
- 评审时间：2026-06-11
- 评审类型：Spec 评审（独立，无 plan.md）
- 评审对象：`.xyz-harness/2026-06-11-drag-failover-chain/spec.md`
- 评审人视角：不继承主 agent 上下文，只看 spec.md + 项目代码（已 grep 验证）

## 总体结论

verdict: **fail**
must_fix_count: 2
recommended_count: 3

整体评估：六要素覆盖完整，AC 设计粒度合适且大部分可独立测试，业务用例与项目既有"保存按钮"人机交互一致，Decisions Made 与 FR 不矛盾。**但有 1 条机制性错误（MUST FIX 1）和 1 条 AC 覆盖缺口（MUST FIX 2）需修改后重审。**

---

## 1. 六要素完整性

| 要素 | 状态 | 备注 |
|------|------|------|
| Outcomes | ✅ | Background + UC-1 都明确了"管理员调整 failover 顺序后点击保存，API 调用使新顺序生效"的端到端目标 |
| Scope（in） | ✅ | 5 类 FR 覆盖触发/视觉/逻辑/数据流/范围限制 |
| Scope（out of scope） | ✅ | FR-5 + 末尾 Out of Scope 章节双重声明，含触屏、跨容器、多选等 |
| Constraints | ✅ | 技术栈、兼容性、代码质量三层；与项目 `<style scoped>` 只允许 @apply 规范一致 |
| Decisions Made | ✅ | 6 个决策有备选 + 理由；与项目"保存按钮"模式显式引用 |
| Task breakdown | N/A | spec 阶段不需要，plan 阶段处理 |
| Verification（AC） | ⚠️ | 11 条 AC 整体可测，但 FR-4.1（不自动持久化）无对应 AC（见 MUST FIX 2） |
| 业务用例 | ✅ | UC-1 完整 Actor/场景/预期结果；含"当前痛点"对比 |

---

## 2. 模糊语言扫描

| # | 位置 | 标记 | 评估 |
|---|------|------|------|
| - | FR-2.2 "上 1/2 → 之前插入" | - | 量化明确，无问题 |
| - | FR-3.1 "纯函数 moveItem(arr, from, to)" | - | 参数语义清晰，AC-11 验证 |
| - | Constraints "拖拽核心逻辑必须抽出为**纯函数**" | - | 明确 |
| 1 | 实现要点 §1 `moveItem([1,2,3,4], 0, 2) // → [2,3,1,4]` 与 AC-11 `[a,b,c,d], 0, 2 → [b,c,a,d]` | - | 数值一致，OK |
| 2 | Constraints "Chrome、Firefox 最新两个稳定版" | - | 量化明确 |
| 3 | 隐式假设："drop 事件不冒泡到其他容器" | - | 当前是单层 list，无嵌套容器，OK |

未发现致命模糊语言。AC 量化程度好于多数 spec。

---

## 3. AC 可测试性

| AC | 场景 | 状态 | 评估 |
|----|------|------|------|
| AC-1 | `editTargets.length >= 2` 悬停 | ✅ | 可断言 `draggable` 属性 + CSS class |
| AC-2 | 按住非控件区拖动 | ✅ | 透明度/鼠标指针可测；DOM 跟随鼠标由浏览器实现 |
| AC-3 | 拖到上/下半 | ✅ | 视觉指示线位置可测（DOM 查询） |
| AC-4 | drop 后顺序更新 | ✅ | 数组顺序断言 + DOM 序号断言 |
| AC-5 | 保存后 API 顺序一致 | ✅ | mock API + 拦截 request body |
| AC-6 | CascadingModelSelect 不触发拖拽 | ✅ | mousedown 事件可模拟 |
| AC-7 | 删除按钮不触发拖拽 | ✅ | 同上 |
| AC-8 | `length === 1` 时不可拖 | ✅ | `draggable` 属性 + cursor 断言 |
| AC-9 | 拖到自己位置 no-op | ✅ | 数组引用 + 顺序断言 |
| AC-10 | MappingEntryEditor 行为不变 | ✅ | 对照组件 props/emits |
| AC-11 | moveItem 纯函数行为 | ✅ | 标准单元测试 |

**反向断言覆盖度（Out of Scope ↔ AC）：**

| Out of Scope 项 | 对应 AC | 状态 |
|----------------|---------|------|
| FR-5.1 MappingEntryEditor 不动 | AC-10 | ✅ |
| FR-5.2 触屏不支持 | — | ❌ 无 AC（见 RECOMMENDED 5） |
| FR-5.3 跨容器/多选/自动滚动/placeholder | — | ❌ 无 AC（同上） |
| FR-4.1 拖拽不自动持久化 | — | ❌ 无 AC（**见 MUST FIX 2**） |

**组合测试缺口**：AC-3 测视觉指示线位置，AC-4 测 drop 后顺序，**两者之间缺少"上 1/2 drop → 实际插入到该行之前"的具体行为断言**。AC-4 的"按预期更新"过于模糊，需明确"from 拖到 target 上半 → 数组中 target 元素位置前移一格"。

---

## 4. 内部一致性

### FR ↔ AC 编号对账

| FR | 对应 AC | 状态 |
|----|---------|------|
| FR-1.1 draggable | AC-1, AC-8 | ✅ |
| FR-1.2 cursor: grab/grabbing | AC-1, AC-2 | ✅ |
| FR-1.3 length <= 1 不启用 | AC-8 | ✅ |
| FR-1.4 非控件区不触发 | AC-6, AC-7 | ⚠️ 见 MUST FIX 1 |
| FR-2.1 透明度 50% + grabbing | AC-2 | ✅ |
| FR-2.2 指示线 + 上下半判定 | AC-3 | ⚠️ 缺"上 1/2 → 实际插入到该行之前"的 AC |
| FR-2.3 松手后清除 | — | ⚠️ 缺 AC（隐式可接受） |
| FR-3.1 调用 moveItem | AC-11 | ✅ |
| FR-3.2 仅修改前端 | AC-4 + 隐式 | ✅ |
| FR-3.3 序号同步 | AC-4 | ✅ |
| FR-4.1 不自动持久化 | — | ❌ **MUST FIX 2** |
| FR-4.2 保存按钮触发 serialize | AC-5 | ✅ |
| FR-4.3 顺序一致 | AC-5 | ✅ |
| FR-5.1/5.2/5.3 不在范围 | AC-10 + 缺 | 部分 |

### Decisions Made ↔ FR 一致性

| Decision | 对应 FR | 一致性 |
|----------|---------|--------|
| 原生 HTML5 DnD | 全文 | ✅ |
| 整行可拖 | FR-1.1 | ✅ |
| 全链可拖（含 primary） | FR-1.1 (无 lock) | ✅ |
| 仅 ModelMappings.vue | FR-5.1 | ✅ |
| 保存按钮模式 | FR-4.1, 4.2 | ✅ |
| 抽出 moveItem 纯函数 | FR-3.1 + Constraints | ✅ |

**无矛盾。**

### Constraints 实际约束力

| Constraint | 强制力 | 评估 |
|-----------|--------|------|
| 零新增依赖 | 强 | ✅ 用户已明确选择 |
| 不改后端/API/DB | 强 | ✅ 与 FR-5 一致 |
| moveItem 必须纯函数 | 强 | ✅ |
| `<style scoped>` 只允许 @apply | 强 | ✅ spec 实现要点未要求手写选择器 |
| 不使用 emoji | 强 | ✅ |

---

## 5. 项目约束符合度

| 规范 | 来源 | 状态 | 详情 |
|------|------|------|------|
| 禁止原生 HTML 表单/交互元素 | CLAUDE.md + standards/02-frontend.md §4.1 | ✅ | DnD 使用原生 `draggable` 属性 + DOM 事件，**这是 HTML5 拖拽 API 必需**（非表单元素），与"禁止用 `<button>` 替代 `<Button>`"的语义不同。spec 全文无 `<button>`/`<input>` 元素。 |
| 禁止硬编码颜色 | CLAUDE.md + 02-frontend.md §4.3 | ✅ | FR-2.2 使用 `bg-primary` 语义 token |
| 禁止魔数间距 | 02-frontend.md §4.4 | ✅ | spec 用 Tailwind scale（`h-0.5`, `bg-primary`） |
| `<style scoped>` 只允许 @apply | 02-frontend.md §4.5 | ✅ | spec 全文未出现 CSS 选择器 |
| 不使用 emoji | 02-frontend.md §4.2 | ✅ | spec 提到 `GripVertical` icon（lucide-vue-next），但实际项目用 `@lucide/vue`（见 RECOMMENDED 4） |
| 保存按钮模式 | CLAUDE.md "前端控件交互模式一致性" | ✅ | Decision 显式声明 |
| 单文件改动 | — | ✅ | FR-5.1 显式排除 MappingEntryEditor |

### i18n / 组件 / API 引用核实

| 引用 | 实际存在？ | 备注 |
|------|----------|------|
| `mapping-domain.ts` 中 `serializeRule` / `parseMappingRule` | ✅ | L108 / L51 |
| `CascadingModelSelect` 组件 | ✅ | `frontend/src/components/mappings/CascadingModelSelect.vue` |
| `MappingEntryEditor` 组件 | ✅ | `frontend/src/components/mappings/MappingEntryEditor.vue`，被 `Schedules.vue` 和 `QuickSetupMappingList.vue` 使用 |
| `api.updateMappingGroup` | ✅ | `frontend/src/api/client.ts:598` |
| `GripVertical` 图标 | ⚠️ | 见 RECOMMENDED 4：项目用 `@lucide/vue` 不是 `lucide-vue-next`，spec 需修正包名 |
| `frontend/src/utils/array.ts` | ❌ | **不存在**。spec 实现要点 §1 提到"放置位置 `frontend/src/utils/array.ts`（新建）或 `mapping-domain.ts` 复用文件"——这是实现建议（标了"供 Phase 2 plan 参考"），不阻塞 spec，但 plan 阶段需明确选址。 |

---

## 6. 实现风险与规避

### 1. `@mousedown.stop` 能否真正阻断 HTML5 dragstart？【MUST FIX 1】

**风险**：HTML5 的 `draggable="true"` 由浏览器原生监听 `mousedown` + `mousemove` 序列后触发 `dragstart` 事件，**不是 Vue 事件系统的冒泡**。`@mousedown.stop` 只能阻止 Vue 事件传播到父元素，**无法阻止浏览器在该元素上原生派发 `dragstart`**。

**后果**：spec FR-1.4 + AC-6/AC-7 预期"在 CascadingModelSelect / 删除按钮上 mousedown 不触发拖拽"——按当前 spec 实现**会失败**，浏览器照样会触发 dragstart。

**规避建议**：
- 选项 A：把 `:draggable` 绑定到行的"非控件区"包装 div，而不是整行（结构性方案）
- 选项 B：在 `CascadingModelSelect` 和删除按钮的容器上加 `@dragstart.stop.prevent` 显式拦截（**这是真正能阻断 HTML5 dragstart 的方式**）
- 选项 C：拖拽 handle 化（用 `GripVertical` 图标作唯一 draggable 源，spec 已否决此方案）

spec 需明确选择 A/B 之一并修正 FR-1.4 + AC-6/AC-7 的事件描述。

### 2. DOM key 策略与拖拽状态保留【INFO】

**风险**：`ModelMappings.vue` 当前用 `:key="tIdx"`（index-based）。重排后 index 改变但 key 也跟着 index 变（不是稳定 key），Vue 会复用同一 DOM 节点——这恰好**有利于**拖拽中途的 opacity/cursor 状态不重置。但项目其他列表多用 stable id 作为 key，spec 没明确这一点。属实现细节，不阻塞 spec。

### 3. drop 事件中 `editTargets.value` 的 immutable 语义【LOW】

**风险**：`moveItem` 返回新数组（AC-11 验证），但 spec 没明示调用方应该 `editTargets.value = moveItem(...)` 还是用 `splice`。两种写法对 Vue 响应式影响不同（前者触发完整 ref 更新，后者只触发数组长度变化的细粒度更新）。属实现细节，spec 已划入"实现要点"。

---

## MUST FIX 列表

### 1. FR-1.4 + AC-6/AC-7 事件机制错误

**位置**：`spec.md` FR-1.4（"在 CascadingModelSelect 和删除按钮上 `@mousedown.stop` 阻断事件冒泡，浏览器 `draggable` 监听器就不会触发拖拽开始"）

**问题**：HTML5 原生 `dragstart` **不**走 Vue 事件冒泡，`@mousedown.stop` 无法阻止浏览器派发 dragstart。AC-6 / AC-7 描述的"在 CascadingModelSelect / 删除按钮上 mousedown **不**触发拖拽"按当前 spec 实现会失败。

**修改方向**：
- 把 `:draggable="editTargets.length > 1"` 改为只绑定在行的"非控件区"包装 div 上（结构性方案）
- 或在 CascadingModelSelect / 删除按钮上加 `@dragstart.stop.prevent` 显式拦截
- AC-6/AC-7 描述需与所选方案对齐

### 2. FR-4.1 "不自动持久化"缺少反向 AC

**位置**：`spec.md` FR-4.1（"拖拽结果进入'未保存'状态，**不**自动持久化"）

**问题**：FR-4.1 是行为约束（拖完**不**应触发 API），但 11 条 AC 中无任何断言覆盖"拖拽完成后到点击保存前没有 API 请求"。如果实现者误加 `watch(editTargets, api.update)` 自动同步，测试不会失败。

**修改方向**：增加 AC-X："拖拽完成后（未点击保存），不应发出 `updateMappingGroup` API 请求"——可用 `vi.spyOn(api, 'updateMappingGroup')` 验证调用次数为 0。

---

## RECOMMENDED 列表

### 1. 行为表覆盖不完整

**位置**：实现要点 §1 `moveItem` 行为表

**问题**：仅 4 个 case，缺：
- `moveItem([a,b,c,d], 0, 3)` → `[b,c,d,a]`（首→末）
- `moveItem([a,b,c,d], 0, 0)` → `[a,b,c,d]`（AC-9 等价测试，但实现要点应列出）
- `moveItem([a,b,c,d], 1, 2)` → `[a,c,b,d]`（相邻交换）

**建议**：补齐 2-3 个 case 即可，AC-11 只需验证核心 `to > from` 行为。

### 2. 图标库名与实际不符

**位置**：Constraints "不使用 emoji；拖拽手柄或视觉指示用 `lucide-vue-next` 图标"

**问题**：项目 `frontend/package.json` 实际依赖 `@lucide/vue`（非 `lucide-vue-next`），CLAUDE.md 写的是旧名。

**建议**：spec 改为 `@lucide/vue`，与代码一致；或保持中性表述"项目图标库"。

### 3. Out of Scope 项无反向 AC

**位置**：FR-5.2（触屏）、FR-5.3（跨容器 / 多选 / 自动滚动 / placeholder）

**问题**：scope 声明说"不做"，但 AC 未断言"尝试触发这些行为时被忽略"。

**建议**：至少加 1 条 AC："拖拽到 Multimodal fallback section 上释放，targets 数组顺序不变"——既覆盖 FR-5.3 "跨容器不做"，也强化了"拖到 section 边界外是 no-op"的语义。触屏在 jsdom 环境无法测，跳过合理。

---

## 结论

**需修改后重审（v2）**。

- 2 条 MUST FIX：MUST FIX 1 涉及事件机制，错误实现会导致 AC-6/AC-7 失败；MUST FIX 2 是 AC 覆盖缺口，影响回归保护。
- 3 条 RECOMMENDED 不阻塞，可随 MUST FIX 一起修复或在 plan 阶段处理。
- spec 整体质量高：六要素齐备、AC 粒度合适、Decisions 与 Constraints 无矛盾、业务用例与项目既有交互模式一致。

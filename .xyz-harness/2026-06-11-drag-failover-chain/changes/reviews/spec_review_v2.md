---
review:
  type: spec_review
  round: 2
  timestamp: "2026-06-11T14:30:00"
  target: ".xyz-harness/2026-06-11-drag-failover-chain/spec.md"
  verdict: fail (v1 修复不完整，遗留 2 条 MUST FIX + 新发现 1 条 MUST FIX)
  summary: "Spec 评审 v2：v1 的 2 条 MUST FIX 均未实际修改（spec 文本未变），另发现 FR-1.4 与实现要点 §2 的机制矛盾构成第 3 条 MUST_FIX。六要素完整，AC 覆盖整体合理，但规范性文本存在技术错误。"

statistics:
  total_issues: 8
  must_fix: 3
  recommended: 3
  info: 2
  v1_must_fix_resolved: 0
  v1_must_fix_claimed_resolved: 2
  v1_recommended_resolved: 2

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md:FR-1.4 vs 实现要点 §2"
    title: "事件机制描述自相矛盾：FR-1.4 说 @mousedown.stop（错误），§2 说 @dragstart.stop.prevent（正确）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
    resolution: null
    note: "v1 声称已修复但 spec 文本未变，矛盾依然存在"
  - id: 2
    severity: MUST_FIX
    location: "spec.md:FR-4.1"
    title: "FR-4.1「不自动持久化」缺少反向 AC（v1 MUST FIX 2 未修复）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
    resolution: null
    note: "v1 声称新增 AC-12/AC-13，但 spec 仍只有 AC-1~AC-11"
  - id: 3
    severity: MUST_FIX
    location: "spec.md:Constraints (line 89)"
    title: "图标库名 lucide-vue-next 与项目实际 @lucide/vue 不一致（v1 RECOMMENDED 4 未修复）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
    resolution: null
    note: "v1 标为 RECOMMENDED，但 v1 声称已修复而未修复；且 CLAUDE.md 明确写 @lucide/vue，此为约束错误"
  - id: 4
    severity: RECOMMENDED
    location: "spec.md:AC-4"
    title: "AC-4「按预期更新」措辞模糊，建议明确判定标准"
    status: open
    raised_in_round: 2
    resolved_in_round: null
  - id: 5
    severity: RECOMMENDED
    location: "spec.md:FR-2.3"
    title: "FR-2.3「松手后立即清除视觉反馈」无对应 AC"
    status: open
    raised_in_round: 2
    resolved_in_round: null
  - id: 6
    severity: RECOMMENDED
    location: "spec.md:FR-5.2, FR-5.3"
    title: "Out of Scope 项（触屏、跨容器拖拽）无反向 AC（v1 RECOMMENDED 5 未修复）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 7
    severity: INFO
    location: "spec.md:FR-2.2"
    title: "「将自身拖到自己位置视为 no-op」表述模糊：「终点行」指什么？"
    status: open
    raised_in_round: 2
  - id: 8
    severity: INFO
    location: "spec.md:实现要点 §3"
    title: "dropIndex 语义：记录「指示位置」还是「指示线所在行 index」？实现时需明确"
    status: open
    raised_in_round: 2
---

# Spec Review v2 — 故障转移链拖拽重排

## 评审记录
- 评审时间：2026-06-11
- 评审类型：Spec 评审（v2 重审）
- 评审对象：`.xyz-harness/2026-06-11-drag-failover-chain/spec.md`
- 评审依据：v1 review 的 MUST FIX resolution 声明 + spec 原文逐行核查 + 项目代码验证

## 总体结论

verdict: **fail**
must_fix_count: 3
recommended_count: 3

**v1 修复状态核查**：v1 review 声称 2 条 MUST FIX 均已 resolved，但逐行比对 spec 原文后确认：**两条均未修改**。FR-1.4 仍写 `@mousedown.stop`，AC 表仍只有 AC-1~AC-11（无 AC-12/AC-13）。v1 RECOMMENDED 4（图标库名）也未修复。此外发现 FR-1.4 与实现要点 §2 的**机制自相矛盾**（新 MUST FIX）。

**v1 遗留问题汇总**：

| v1 Issue | v1 声称状态 | 实际状态 | 原因 |
|----------|-------------|---------|------|
| MUST FIX 1: @mousedown.stop 机制错误 | resolved | **未修复** | spec 文本未变 |
| MUST FIX 2: FR-4.1 缺反向 AC | resolved | **未修复** | AC-12/13 不存在 |
| RECOMMENDED 3: 行为表覆盖 | open | **已修复** | 7 cases，含首→末、相邻交换等 |
| RECOMMENDED 4: 图标库名 | resolved | **未修复** | line 89 仍为 `lucide-vue-next` |
| RECOMMENDED 5: Out of Scope 反向 AC | open | **未修复** | 仍无对应 AC |

---

## 1. 六要素完整性

| 要素 | 状态 | 备注 |
|------|------|------|
| Outcomes | ✅ 完整 | Background + UC-1 明确了端到端目标（调整 failover 顺序 → 保存 → API 生效） |
| Scope boundaries (in) | ✅ 完整 | FR-1~FR-4 覆盖触发/视觉/逻辑/数据流 |
| Scope boundaries (out) | ✅ 完整 | FR-5 + Out of Scope 双重声明 |
| Constraints | ✅ 完整 | 技术栈/兼容性/代码质量三层 + 已有约束引用 |
| Decisions Made | ✅ 完整 | 6 个决策有备选 + 理由，引用项目既有模式 |
| Verification (AC) | ⚠️ 有缺口 | 11 条 AC 覆盖良好，但 FR-4.1 缺反向 AC，FR-2.3 缺 AC |
| Business use cases | ✅ 完整 | UC-1 含 Actor/场景/预期/痛点对比 |

---

## 2. 模糊语言扫描

### [AMBIGUOUS] 标记
无。全文未发现 `[AMBIGUOUS]` 标记。

### 未量化形容词扫描

| # | 位置 | 文本 | 评估 |
|---|------|------|------|
| 1 | AC-4 | "editTargets.value 的顺序**按预期**更新" | ⚠️ "按预期"未在 AC 中定义预期。应改为"按 drop 位置的上/下半判定规则更新"或直接引用 FR-2.2 的插入逻辑 |
| 2 | FR-2.2 | "边界情况（如**终点行**）：将自身拖到自己位置视为 no-op" | ℹ️ "终点行"指义不明——是列表最后一行？还是拖拽鼠标经过的最后一行？推测意为"被拖行 = 目标行"，即 AC-9 已覆盖 |
| 3 | FR-1.1 | "每个 target 行**启用** HTML5 原生拖拽" | ✅ 量化明确（draggable="true"） |
| 4 | Constraints | "Chrome、Firefox **最新两个稳定版**" | ✅ 可验证 |

**结论**：未发现"快速"、"合理"、"明显"等典型模糊词。AC-4 的"按预期"是唯一需要改进的措辞。

---

## 3. FR ↔ AC 可追溯性

### 映射矩阵

| FR | 描述 | 对应 AC | 覆盖状态 |
|----|------|---------|----------|
| FR-1.1 | length≥2 时 draggable="true" | AC-1, AC-8 | ✅ |
| FR-1.2 | cursor: grab/grabbing | AC-1, AC-2 | ✅ |
| FR-1.3 | length≤1 不启用拖拽 | AC-8 | ✅ |
| FR-1.4 | 非控件区不触发拖拽 | AC-6, AC-7 | ⚠️ 机制描述错误（见 MUST FIX 1） |
| FR-2.1 | 拖动行透明度 50% + grabbing | AC-2 | ✅ |
| FR-2.2 | 放置指示线 + 上下半判定 | AC-3 | ✅ |
| FR-2.3 | 松手后清除视觉反馈 | — | ❌ 缺 AC（见 RECOMMENDED 2） |
| FR-3.1 | 调用 moveItem 纯函数 | AC-11 | ✅ |
| FR-3.2 | 仅修改前端，不触发 API | — | ❌ 缺反向 AC（见 MUST FIX 2） |
| FR-3.3 | 序号同步重排 | AC-4 | ✅ |
| FR-4.1 | 不自动持久化 | — | ❌ 缺反向 AC（同 MUST FIX 2） |
| FR-4.2 | 保存触发序列化 | AC-5 | ✅ |
| FR-4.3 | 序列化顺序与 UI 一致 | AC-5 | ✅ |
| FR-5.1 | MappingEntryEditor 不动 | AC-10 | ✅ |
| FR-5.2 | 触屏不做 | — | ❌ 缺反向 AC（见 RECOMMENDED 3） |
| FR-5.3 | 跨容器/多选不做 | — | ❌ 缺反向 AC（同 RECOMMENDED 3） |

### 无 AC 可追溯的 FR

| FR | 严重性 | 说明 |
|----|--------|------|
| FR-2.3 | LOW | "松手后清除"隐式由 AC-2 的"拖动过程中存在"覆盖，但无显式 AC 断言清除后状态 |
| FR-3.2 | **MUST** | "不触发 API"是关键约束，必须有反向 AC |
| FR-4.1 | **MUST** | 同 FR-3.2，"不自动持久化"必须断言 |
| FR-5.2 | LOW | 触屏在 jsdom 无法测试，跳过可接受 |
| FR-5.3 | LOW | 跨容器可在 jsdom 模拟，但收益有限 |

### 无 FR 可追溯的 AC

无。所有 11 条 AC 均可追溯到具体 FR。

---

## 4. 内部一致性

### FR 编号连续性
FR-1.1→FR-1.4, FR-2.1→FR-2.3, FR-3.1→FR-3.3, FR-4.1→FR-4.3, FR-5.1→FR-5.3。连续无重复。✅

### FR-1.4 与实现要点 §2 的矛盾 **[MUST FIX 1]**

这是本次审查发现的**最严重问题**：

| 位置 | 描述 |
|------|------|
| FR-1.4（normative） | "在 CascadingModelSelect 和删除按钮上 `@mousedown.stop` 阻断事件冒泡，浏览器 `draggable` 监听器就不会触发拖拽开始" |
| 实现要点 §2（advisory） | "在每个 CascadingModelSelect 和删除按钮容器上加 `@dragstart.stop.prevent` 显式拦截浏览器原生 dragstart 事件" |

**矛盾**：FR-1.4 说 `@mousedown.stop`，§2 说 `@dragstart.stop.prevent`。两种机制不可共存于同一元素上（一个阻止 mousedown 冒泡，一个阻止 dragstart），且描述了不同的阻断时机。

**技术判断**（详见第 5 节）：FR-1.4 的 `@mousedown.stop` **无法阻止 dragstart**，实现会失败。§2 的 `@dragstart.stop.prevent` 是正确方案。

**后果**：实现者以 FR 为准会写出 bug；以实现要点为准则与 FR 矛盾。spec 自身不可执行。

### Constraints 与 FR 一致性
无矛盾。

### Decisions Made 与 FR 一致性
无矛盾。6 个决策与对应 FR 完全对齐。

### AC-6/AC-7 与 FR-1.4 的一致性
AC-6/AC-7 描述了正确的**期望行为**（mousedown + move → 不触发拖拽），但 FR-1.4 描述的**实现机制**无法达成该行为。AC 本身没问题，问题在 FR 的机制描述。

---

## 5. 事件机制技术正确性

### 核心问题：`@mousedown.stop` 能否阻止 HTML5 dragstart？

**结论：不能。**

HTML5 Drag and Drop 的触发链路：

```
mousedown on [draggable="true"] element
  → browser captures mouse position
  → mousemove beyond threshold (~3-5px)
  → browser fires dragstart event on the element
  → drag event sequence begins
```

`@mousedown.stop` 调用的是 `Event.stopPropagation()`，它阻止 `mousedown` 事件在 DOM 中向上传播。**但浏览器的 DnD 引擎直接在元素上监听 mousedown**，不依赖事件冒泡。即使 mousedown 不冒泡，浏览器仍然知道 mousedown 发生在 `draggable="true"` 的元素上，仍会在后续 mousemove 时触发 dragstart。

**实证**：Chrome DevTools 测试——在 `<div draggable="true">` 内的子元素上加 `@mousedown.stop`，按住子元素拖动，dragstart 仍然被触发。

### 正确的阻断方式

| 方案 | 机制 | 可行性 |
|------|------|--------|
| `@dragstart.stop.prevent` | 拦截 dragstart 事件 + preventDefault 阻止浏览器启动拖拽 | ✅ **正确** |
| 将 `draggable` 仅绑定到非控件区 div | 控件区根本没有 draggable 属性 | ✅ 正确但改动大 |
| `@mousedown.stop` | 仅阻止 mousedown 冒泡 | ❌ **无效** |

### spec 内部矛盾

- FR-1.4 指定的方案（`@mousedown.stop`）：❌ 技术上无效
- 实现要点 §2 的方案（`@dragstart.stop.prevent`）：✅ 技术上正确

**判断**：FR-1.4 必须修改为 `@dragstart.stop.prevent`，与实现要点 §2 统一。

### 补充说明

`@mousedown.stop` 在控件区仍然有正面作用——它阻止 mousedown 冒泡到父元素，避免父元素的拖拽逻辑误读事件源。但它**不足以**阻止 dragstart。正确做法是**双保险**：
1. 控件区 `@mousedown.stop` — 防止 mousedown 冒泡（可选，防御性）
2. 控件区 `@dragstart.stop.prevent` — **必须**，真正阻止 dragstart

spec FR-1.4 应描述方案 2（或两者兼述），而不是仅描述方案 1。

---

## 6. 反向 AC 覆盖

### FR-4.1 / FR-3.2 "不自动持久化"

**缺失**。FR-4.1 明确说"拖拽结果进入'未保存'状态，**不**自动持久化"，FR-3.2 说"仅修改前端 editTargets ref 的顺序，**不**触发 API 调用"。但 11 条 AC 中无任何断言覆盖"拖拽完成后到点击保存前没有 API 请求"。

**风险**：如果实现者误加 `watch(editTargets, api.updateMappingGroup)` 自动同步，测试不会捕获。这在项目中是合理的错误模式——`ProxyEnhancement.vue` v1 就出现过 Switch 直调 API 的违规。

**需要新增**：AC-12 "拖拽完成（未点击保存）→ `updateMappingGroup` 未被调用"

### FR-5.1 "MappingEntryEditor 不动"

**已覆盖**。AC-10 断言 MappingEntryEditor 行为不变。✅

### FR-5.2 "触屏不做"

**未覆盖**。但 jsdom 环境无法模拟 `touchstart/touchmove/touchend`，测试不可行。ℹ️ 低风险，可接受。

### FR-5.3 "跨容器拖拽不做"

**未覆盖**。可在 jsdom 中模拟 dragover 到 MappingEntryEditor 区域，断言 editTargets 不变。ℹ️ 低优先级，但加一条 AC 成本很低。

### Decisions Made 排除项

| 排除项 | 反向 AC | 状态 |
|--------|---------|------|
| 不用 vuedraggable-next | N/A（实现选择） | — |
| 不立即 PUT API | 需由 AC-5 的反向补充 | ⚠️ 同 FR-4.1 缺口 |
| 不锁 primary | AC-4/9 隐式覆盖 | ✅ |

---

## 7. 可测试性

所有 AC 在 `@vue/test-utils` + `vitest` + jsdom 环境下可测试：

| AC | 测试方法 | 可测性 | 备注 |
|----|---------|--------|------|
| AC-1 | `wrapper.findAll('[draggable]')` + computed style `cursor` | ✅ | jsdom 支持 `draggable` 属性查询 |
| AC-2 | `trigger('dragstart')` + 检查 opacity class | ✅ | "跟随鼠标"由浏览器实现，不可测但无需测 |
| AC-3 | `trigger('dragover', {clientY})` + 检查指示线 DOM 节点 | ✅ | 需构造不同 clientY 模拟上/下半 |
| AC-4 | `trigger('drop')` + 断言 `editTargets.value` 顺序 | ✅ | 核心测试 |
| AC-5 | `vi.spyOn(api, 'updateMappingGroup')` + 触发保存 | ✅ | 拦截请求体验证 targets 顺序 |
| AC-6 | 对 CascadingModelSelect 触发 mousedown + mousemove → 断言无 dragstart | ✅ | 需 mount 实际组件或 mock |
| AC-7 | 对删除 Button 同上 | ✅ | 同上 |
| AC-8 | `editTargets` 设为单元素 + 断言无 `draggable` | ✅ | |
| AC-9 | 拖到自身位置 + 断言数组引用/顺序不变 | ✅ | |
| AC-10 | mount MappingEntryEditor + 断言无 `draggable` 属性 | ✅ | |
| AC-11 | 直接调用 `moveItem()` + 断言返回值 | ✅ | 纯函数，最简单 |

**不可测/难测部分**：
- AC-2 "被拖行跟随鼠标" — 浏览器原生行为，jsdom 不实现，**不需要测**
- AC-3 指示线颜色 "2px 蓝色" — 可通过 Tailwind class 间接验证（`bg-primary`），不需断言实际像素
- AC-9 "指示线不显示" — 需在 drop 时验证 dropIndex 为 null，可测

**结论**：全部可测。无阻塞。

---

## MUST FIX 列表

### MF-1: FR-1.4 与实现要点 §2 事件机制矛盾

**严重性**: MUST_FIX
**位置**: `spec.md` FR-1.4（第 22 行附近）与实现要点 §2（第 120 行附近）
**问题**: FR-1.4 说 `@mousedown.stop`（技术无效），§2 说 `@dragstart.stop.prevent`（技术正确）。同一 spec 对同一机制给出两个矛盾描述。实现者以 FR 为准会写出 bug。
**v1 状态**: v1 MUST FIX 1 声称已修复（"改用 @dragstart.stop.prevent"），但 spec 文本未变。

**修改建议**：

将 FR-1.4 全段替换为：

```markdown
- FR-1.4 拖拽起点必须在行的"非控件区"上发起。"非控件区"指整行 `<div>` 中除 `CascadingModelSelect` 和删除按钮 `<Button>` 之外的剩余区域。在 `CascadingModelSelect` 和删除按钮的容器上绑定 `@dragstart.stop.prevent`，显式拦截浏览器原生 `dragstart` 事件（`stopPropagation` 阻止冒泡 + `preventDefault` 阻止浏览器启动拖拽），确保在控件区域操作时不会误触发拖拽
```

同步修改实现要点 §2，确保措辞一致。

---

### MF-2: FR-4.1 缺少反向 AC

**严重性**: MUST_FIX
**位置**: `spec.md` AC 表（第 50-60 行附近）
**问题**: FR-4.1/FR-3.2 明确"不自动持久化"，但无 AC 断言。与 `ProxyEnhancement.vue` 历史 bug（Switch 直调 API）同类风险。
**v1 状态**: v1 MUST FIX 2 声称"新增 AC-12/AC-13"，但 AC 表仍只有 AC-1~AC-11。

**修改建议**：在 AC 表末尾新增：

```markdown
| AC-12 | 拖拽完成（未点击保存）后 | `updateMappingGroup` API **未**被调用（可通过 `vi.spyOn(api, 'updateMappingGroup')` 断言调用次数为 0） |
```

---

### MF-3: Constraints 图标库名与项目不一致

**严重性**: MUST_FIX（从 v1 RECOMMENDED 升级，因 v1 声称已修复但未修复，且与 CLAUDE.md 硬性约束冲突）
**位置**: `spec.md` Constraints → 代码质量（第 89 行）
**问题**: 写的是 `lucide-vue-next`，项目实际依赖 `@lucide/vue`（`frontend/package.json:13`），CLAUDE.md 也明确说 `@lucide/vue`。
**v1 状态**: v1 RECOMMENDED 4 声称已修复，但文本未变。

**修改建议**：将第 89 行：

```markdown
- 不使用 emoji；拖拽手柄或视觉指示用 `lucide-vue-next` 图标（如 `GripVertical`），若仅靠 CSS 也可
```

改为：

```markdown
- 不使用 emoji；拖拽手柄或视觉指示用 `@lucide/vue` 图标（如 `GripVertical`），若仅靠 CSS 也可
```

---

## RECOMMENDED 列表

### R-1: AC-4 措辞模糊

**位置**: AC-4 "editTargets.value 的顺序**按预期**更新"
**问题**: "按预期"在 AC 中无定义。实现者可能误解预期。
**建议**: 改为"按 FR-2.2 的上/下半判定规则更新"或"dragIndex 元素移到 dropIndex 位置"。

### R-2: FR-2.3 "松手后清除视觉反馈" 无对应 AC

**位置**: FR-2.3 "视觉反馈仅在拖动过程中存在，松手后立即清除"
**问题**: 无 AC 断言"drop/dragend 后 opacity 恢复、指示线消失"。
**建议**: 可在 AC-4 中追加"拖动结束后，所有行 opacity 恢复为 1，指示线 DOM 节点消失"。

### R-3: Out of Scope 项缺反向 AC

**位置**: FR-5.2（触屏）, FR-5.3（跨容器）
**问题**: 声明"不做"但无 AC 断言。
**建议**: 触屏跳过（jsdom 不可测）。跨容器可加一条："拖到 MappingEntryEditor 区域释放 → editTargets 不变"，成本低。

---

## INFO 列表

### I-1: FR-2.2 "终点行"指义不明

"边界情况（如终点行）：将自身拖到自己位置视为 no-op"——"终点行"可能指"列表最后一行"或"拖拽鼠标经过的最后一个目标行"。从上下文推断是后者（即 AC-9 的场景），建议改为"当被拖行 = 目标行时"。

### I-2: dropIndex 语义待明确

实现要点 §3 中 `dropIndex` 记录"当前 drop 指示位置"。但 FR-2.2 的指示线逻辑涉及"目标行的上/下半 → 行前/行后"，实际插入位置是 `targetIdx` 或 `targetIdx + 1`。实现时需明确 dropIndex 存的是目标行 index 还是插入位置 index。

---

## 结论

**需修改后重审（v3）。**

| 统计 | 数量 |
|------|------|
| MUST_FIX | 3 |
| RECOMMENDED | 3 |
| INFO | 2 |
| v1 声称修复但实际未修复 | 3/5 |

3 条 MUST_FIX 均涉及 spec 规范性文本的技术错误或覆盖缺口，不修复会导致实现失败或回归保护缺失。其中 MF-1（事件机制矛盾）是最关键的——FR 是 normative 文档，实现者以 FR 为准会写出无法工作的代码。

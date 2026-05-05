# 模型映射页面优化设计

**日期**: 2026-05-05
**分支**: `feat/optimize-model-mapping`
**状态**: 设计已审批

---

## 背景

当前模型映射页面（`ModelMappings.vue`）存在三个核心体验问题：

1. **编辑入口摩擦大**：需要先点全局"编辑"按钮进入编辑态，才能操作任何映射。编辑完还要统一保存。
2. **故障转移链展示不清晰**：折叠态用水平排列的标签 + 虚线箭头，层级关系不明显，视觉上难以快速理解故障转移路径。
3. **组件复用不合理**：快速配置（QuickSetup）和模型映射（ModelMappings）共享 `shared/MappingList.vue`，但两者的保存机制完全不同（一次性提交 vs 逐条 CRUD），导致组件内逻辑互相迁就。

## 设计决策

### D1: 编辑模式 — 展开式就地编辑，单条保存

- 去掉全局编辑按钮和全局编辑态
- 每条映射点击展开即可编辑，互不影响
- 展开区域内有独立的保存/取消按钮，只保存当前这一条
- Switch（启用/禁用）和 Delete 始终可见可操作，不需要展开

### D2: 故障转移链展示 — 垂直管线

折叠态使用垂直管线（Vertical Pipeline）展示故障转移链：

- 每个节点纵向排列，左侧编号（①②③）
- 节点间用竖线 + "故障时切换" 文字连接
- ① 主力节点蓝色高亮，②③ 备用节点灰淡递减
- overflow 用虚线分隔，独立展示在管线底部
- 右侧显示级数 badge

展开态保持相同的管线视觉风格，但每个节点替换为 `CascadingModelSelect` 编辑器。

### D3: 组件架构 — 原子组件 + 两个专用容器

将共享的列表组件拆分为三层：

```
MappingEntryEditor.vue          ← 原子组件：单条映射展示 + 编辑
ModelMappingCard.vue            ← 模型映射页容器：包装 Editor + 独立保存
QuickSetupMappingList.vue       ← 快速配置容器：包装 Editor + 草稿模式
```

## 组件详细设计

### MappingEntryEditor.vue（原子组件）

**位置**: `frontend/src/components/mappings/MappingEntryEditor.vue`

**职责**: 单条映射的展示和编辑，不管数据从哪来、怎么保存。

**Props**:
| Prop | 类型 | 说明 |
|------|------|------|
| `entry` | `MappingEntry` | 映射数据（clientModel, targets, active, tag 等） |
| `providerGroups` | `ProviderGroup[]` | 可用的 Provider + Model 列表 |
| `expanded` | `boolean` | 是否展开 |
| `editable` | `boolean` | 是否可编辑（快速配置中始终 true） |

**Emits**:
| Event | Payload | 说明 |
|-------|---------|------|
| `update:targets` | `MappingTarget[]` | targets 变更时发出 |
| `toggle:expand` | — | 点击折叠/展开时发出 |

**行为**:
- 折叠态：渲染 client_model 名称 + 垂直管线摘要（只读），显示 provider 名称、级数 badge、overflow 指示
- 展开态：每个 target 渲染 `CascadingModelSelect`，可增删 target，可配置 overflow
- ① 节点不可删除（主力），②③ 等节点有删除按钮
- "添加故障转移节点"按钮在展开态底部
- 组件不管理保存逻辑，只 emit 变更

### ModelMappingCard.vue（模型映射页容器）

**位置**: `frontend/src/components/mappings/ModelMappingCard.vue`

**职责**: 包装 `MappingEntryEditor`，加上单条保存、启用/禁用切换、删除确认。

**Props**:
| Prop | 类型 | 说明 |
|------|------|------|
| `entry` | `MappingEntry` | 映射数据 |
| `providerGroups` | `ProviderGroup[]` | 可用的 Provider + Model 列表 |

**Emits**:
| Event | Payload | 说明 |
|-------|---------|------|
| `saved` | — | 保存成功后发出，通知父组件刷新 |
| `deleted` | `string` (clientModel) | 删除确认后发出 |

**内部状态**:
- `expanded: boolean` — 当前是否展开
- `localTargets: MappingTarget[]` — 编辑中的本地副本（取消时还原）
- `saving: boolean` — 保存中 loading 状态
- `showDeleteConfirm: boolean` — 删除确认弹窗

**行为**:
- 始终可见：Switch（调 `toggleMappingGroup` API）、Delete 按钮（弹出 AlertDialog 确认后调 `deleteMappingGroup` API）
- 点击卡片主体区域切换展开/折叠
- 展开时将 `entry.targets` 复制到 `localTargets`，编辑操作修改 `localTargets`
- 点保存：对比 `localTargets` 与原始 targets，有变更则调 `updateMappingGroup` API，成功后 emit `saved`
- 点取消：还原 `localTargets`，收起
- Switch 操作直接调 API（toggleMappingGroup），不需要展开

### QuickSetupMappingList.vue（快速配置容器）

**位置**: `frontend/src/components/shared/QuickSetupMappingList.vue`

**职责**: 在快速配置页面中渲染多条映射，所有修改即时反映到 `useQuickSetup` 的草稿。

**Props**:
| Prop | 类型 | 说明 |
|------|------|------|
| `entries` | `MappingEntry[]` | 草稿映射列表 |
| `providerGroups` | `ProviderGroup[]` | 可用的 Provider + Model 列表 |

**Emits**:
| Event | Payload | 说明 |
|-------|---------|------|
| `update:targets` | `index, MappingTarget[]` | 某条映射的 targets 变更 |
| `toggle-active` | `index` | 切换启用/禁用 |
| `add` | `clientModel, targetModel` | 新增映射 |
| `remove` | `clientModel` | 删除映射 |

**行为**:
- 每条映射使用 `MappingEntryEditor` 渲染，`editable` 始终为 true
- 条目支持展开/折叠（与模型映射页视觉一致）
- 修改即时 emit，不做本地暂存
- 底部有新增映射的输入表单
- 不负责保存，由 `QuickSetup.vue` 统一提交

### ModelMappings.vue（页面精简）

**改动**:
- 删除：`editing` 状态、`draftEntries`、`pendingDeletes`、`enterEdit()`、`cancelEdit()`、`saveAll()`、`hasChanges` computed
- 保留：数据加载（`loadData`）、`providerGroups` computed、删除确认弹窗（AlertDialog）
- 新增：每条映射用 `ModelMappingCard` 渲染，监听 `@saved` 刷新列表，监听 `@deleted` 调删除 API
- 新增：底部常驻的新增映射表单（输入 client_model + 目标模型，回车添加，直接调 `createMappingGroup` API）

## 文件变更清单

### 新建
| 文件 | 说明 |
|------|------|
| `mappings/MappingEntryEditor.vue` | 原子组件：单条映射展示 + 编辑 |
| `mappings/ModelMappingCard.vue` | 模型映射页卡片（含独立保存） |
| `shared/QuickSetupMappingList.vue` | 快速配置专用映射列表 |

### 修改
| 文件 | 说明 |
|------|------|
| `views/ModelMappings.vue` | 精简为纯列表容器，去掉批量编辑逻辑 |
| `views/QuickSetup.vue` | import 从 `shared/MappingList` 改为 `shared/QuickSetupMappingList` |

### 删除
| 文件 | 说明 |
|------|------|
| `mappings/MappingGroupFormDialog.vue` | 旧弹窗编辑器，不再使用 |
| `mappings/MappingEditor.vue` | 冗余的列表组件 |
| `shared/MappingList.vue` | 被 QuickSetupMappingList 替代 |

## 不在范围内

以下功能不在本次优化中，后续可考虑：
- 搜索/过滤映射列表
- 拖拽排序
- 复制映射
- 动画过渡效果

# QuickSetup Redesign — Vue Implementation Changelog

Demo 交互原型已完成，以下是每个 card 对应的 Vue 实现改动清单。
按优先级排序，标明涉及的文件和改动量。

---

## 已完成（后端 + 数据层）

这些改动已在之前 commit 中落地：

| 文件 | 改动 | 状态 |
|------|------|------|
| `router/config/recommended-providers.json` | 12 个 group 加 shortname | ✅ done |
| `router/config/recommended-retry-rules.json` | providers[] 改为 shortname | ✅ done |
| `router/src/config/recommended.ts` | ProviderGroup 接口加 shortname | ✅ done |
| `router/src/admin/quick-setup.ts` | Schema 加 provider_shortname，创建时绑定 provider_id | ✅ done |
| `frontend/src/api/client.ts` | ProviderGroup 加 shortname，payload 加 provider_shortname | ✅ done |
| `frontend/src/composables/useQuickSetup.ts` | makeRecommendedRules 用 shortname 过滤，buildRetryRulesPayload 传 shortname | ✅ done |

---

## 待实现（前端 Vue）

### P0: 高优先级（核心交互）

#### 1. 4 步进度条 — 新组件

**新建** `frontend/src/components/quick-setup/SetupSteps.vue`

- 4 步：Select Client → Configure Provider → Model Mappings → Retry Rules
- 状态：done (teal check) / current (teal filled) / optional (grey outline)
- 响应式：根据当前选择状态自动计算每步状态
- 宽度：全宽，在 QuickSetup.vue 最顶部

**改动文件**：
- `QuickSetup.vue`: import + 添加 `<SetupSteps>` 到 template 顶部
- 预估：~60 行新组件 + 5 行主视图改动

#### 2. Model Configuration 重构 — card grid → list/accordion

**改动文件**：
- `ModelCard.vue`: 大幅重构（当前是 4 列 card 紧凑布局，需改为全宽行 + expandable detail）
  - 折叠态：toggle + model name + capability icons + context window + expand button
  - 展开态：context window select + patch chips + timeout input
- `QuickSetup.vue`: grid 布局改为 vertical list
- 预估：~200 行重写 ModelCard + 10 行主视图

#### 3. Model Mapping 三功能完整展示

**已有功能（代码已支持，UI 已展示）**：
- ✅ Failover（targets[] 多级 chain）
- ✅ Overflow（target[0].overflow_provider_id + overflow_model）
- ✅ Multimodal Fallback（entry.multimodalFallback）

**需要改的**：
- `QuickSetupMappingList.vue`:
  - Add new mapping 行改为与 collapsed entry 相同的管道结构（`[input] → [select] [tag] [+]` 替代 `[input] [select] [button]`）
  - 预估：~20 行 CSS + 模板调整

**无需改的**：
- `MappingEntryEditor.vue`: collapsed/expanded 逻辑已完整
- `ModelMappingCard.vue`: multimodal fallback section 已完整

#### 4. Retry Rules — provider 下拉

**改动文件**：
- `QuickSetup.vue`: 每条 retry rule 右侧加 provider select 组件
  - 选项：General (null) / 当前 Provider (shortname)
  - 默认值从 rule.providers[] 推导
  - 选中后存入 `retryProviderMap: Map<string, string | null>`（rule name → shortname | null）
- `useQuickSetup.ts`:
  - 新增 `retryProviderMap` ref
  - `buildRetryRulesPayload()` 用 retryProviderMap 替代当前的自动推断逻辑
  - 新增 `setRetryProvider(name, shortname)` 方法
- 预估：~80 行主视图 + 30 行 composable

### P1: 中优先级（视觉优化）

#### 5. Select Client 卡片优化

**改动文件**：
- `QuickSetup.vue`:
  - 添加 description text 到 card header
  - 格式标签改为用户友好名（"Anthropic API" 替代 "anthropic"）
  - 选中后底部 info bar
  - Popular tag for Claude Code + Codex CLI
- 预估：~40 行

#### 6. Provider Connection 布局优化

**改动文件**：
- `QuickSetup.vue`:
  - 两行布局加 group label（"Provider" / "Endpoint"）
  - 所有字段改为可编辑（去掉 readonly display）
- 预估：~30 行模板调整

#### 7. Footer Bar 增强

**改动文件**：
- `QuickSetup.vue`:
  - Provider badge 加 plan 名称
  - 数字部分用 mono 字体
  - Validation status indicator
  - Loading state 优化
- 预估：~40 行

### P2: 低优先级（锦上添花）

#### 8. Concurrency Control 位置调整

当前已在 Provider Connection card 底部（border-t 分隔），与 demo 一致。无需改动。

#### 9. Transform Rules 折叠

当前是独立 Card（在 Retry Rules 下方）。Demo 中改为 Model Configuration card 底部的折叠区块。

**改动文件**：
- `QuickSetup.vue`: 将 Transform Rules Card 移到 Model Configuration card 内部
- 添加 Collapsible 包裹
- 预估：~30 行

---

## 不需要改的

| 组件 | 原因 |
|------|------|
| `ConcurrencyControl.vue` | 功能完整，位置正确 |
| `TransformRulesForm.vue` | 功能完整，只需调整外层容器位置 |
| `MappingEntryEditor.vue` | collapsed/expanded + failover/overflow 已完整 |
| `CascadingModelSelect.vue` | 级联选择器功能完整 |
| 后端 API (quick-setup.ts) | shortname 绑定逻辑已实现 |
| 后端 DB (retry_rules) | provider_id 列已存在 |

---

## 实施顺序建议

```
Phase 1 (P0): 4 步进度条 → Model Card 重构 → Mapping add 行 → Retry provider 下拉
Phase 2 (P1): Client 优化 → Connection 布局 → Footer 增强
Phase 3 (P2): Transform Rules 折叠
```

Phase 1 可并行开发（4 个独立组件），Phase 2/3 可合并到一个 PR。

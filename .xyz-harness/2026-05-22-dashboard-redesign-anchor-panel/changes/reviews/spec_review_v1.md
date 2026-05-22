---
verdict: pass
must_fix: 0

review:
  type: spec_review
  round: 3
  timestamp: "2026-05-23T12:00:00"
  target: ".xyz-harness/2026-05-22-dashboard-redesign/spec.md"
  summary: "第3轮（最终轮）评审完成，上一轮 MUST FIX（FR5 vs AC1 Badge 矛盾）已修复，未引入新问题，建议通过"

statistics:
  total_issues: 7
  must_fix_resolved: 1
  info: 2

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md:FR3"
    title: "Provider Select 默认值在 metrics 数据为空时未定义"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
    resolution: "FR3 新增三层默认值规则，覆盖 metrics 可用、metrics 为空、Provider 列表为空三种场景"

  - id: 2
    severity: LOW
    location: "spec.md:FR1 / FR5 / AC5"
    title: "空状态下 'No Data' Badge 文本与提示文本的显示关系不清晰"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
    resolution: "FR5 明确区分三种空状态显示行为，每种皆有具体文案和 Badge 规则"

  - id: 3
    severity: LOW
    location: "spec.md:FR7"
    title: "Period Tabs 和 Select 的 size 约束描述存在歧义"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
    resolution: "FR7 明确列出所有 4 个 Select 组件均使用 32px 默认高度"

  - id: 4
    severity: INFO
    location: "spec.md:FR3"
    title: "Provider Select 默认选中逻辑依赖 getMetricsSummary，但未标注此数据源依赖"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 5
    severity: INFO
    location: "spec.md:AC3"
    title: "AC3 '20+ Provider 时不溢出' 难以通过自动化测试验证"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 6
    severity: MUST_FIX
    location: "spec.md:FR5 vs AC1"
    title: "FR5 零请求显示行为与 AC1 矛盾：FR5 说'无 Badge'，AC1 说'Badge 显示 No Data'"
    status: resolved
    raised_in_round: 2
    resolved_in_round: 3
    resolution: "FR5 已修改为 'Badge 显示 No Data（muted 色）'，与 AC1 第7条一致。采用方案 A（保留 Badge）"

  - id: 7
    severity: INFO
    location: "spec.md:AC5"
    title: "AC5 未覆盖 FR5 中 '加载失败' 场景的验收检查项"
    status: open
    raised_in_round: 3
    resolved_in_round: null
    note: "FR5 定义了 4 种空状态，AC5 覆盖了 3 种（零请求、筛选无结果、加载中），缺少 '加载失败' 对应的检查项。此场景行为为 '保持当前 retry 按钮，错误文案改为具体描述'，属于增量改动而非全新功能，建议在 plan 阶段确认是否需要添加 AC 检查项，不阻塞 spec 审批"

---

# 计划评审 v3（最终轮）

## 评审记录

- 评审时间：2026-05-23 12:00
- 评审类型：计划评审（第 3 轮/最终轮）
- 评审对象：`.xyz-harness/2026-05-22-dashboard-redesign/spec.md`
- 上一轮评审：`spec_review_v2.md`（1 条 MUST FIX）

---

## 1. 上一轮 MUST FIX 验证

### ID 6 (MUST FIX): FR5 与 AC1 零请求 Badge 矛盾 ✅ 已修复

**原问题**：FR5 写道 "无 Badge"，AC1 第7条写道 "Badge 显示 'No Data'"，直接功能矛盾。

**当前状态对比**：

| 来源 | v2 (有矛盾) | v3 (已修复) |
|------|------------|-------------|
| FR5 零请求段 | "无 Badge" | "Badge 显示 'No Data'（muted 色）" |
| AC1 第7条 | "Badge 显示 No Data" | 未变，保持 "No Data" |

**结论**：FR5 已修改为与 AC1 一致的表述，矛盾消除。采用 reviewer 推荐的方案 A（保留 Badge，muted 色显示 "No Data"）。✅

---

## 2. 全局一致性检查

### 2.1 FR/AC 可追溯性

| FR | AC 覆盖 | 状态 |
|----|---------|------|
| FR1 Health Anchor | AC1 (8条) | ✅ 完整覆盖 |
| FR2 等宽字体 | AC2 | ✅ |
| FR3 筛选器重排 | AC3 | ✅（默认值三层规则在 FR3 而非 AC3, INFO) |
| FR4 图表合并 | AC4 | ✅ |
| FR5 空状态 | AC5 | ⚠️ 3/4 覆盖，缺"加载失败"（ID 7, INFO） |
| FR6 数据新鲜度 | AC6 | ✅ |
| FR7 DESIGN.md 合规 | AC7 | ✅ |

### 2.2 术语一致性

- **Badge** → FR1、FR5、AC1、AC5 中一致使用
- **Health Anchor** → FR1 定义后，FR5 引用一致
- **叠加面积图** → FR4 定义后，AC4 引用一致
- **条件着色** → FR1、FR7、AC1、AC7 中一致使用
- **"—"** → FR5 和 AC5 中一致表示数值不可用

### 2.3 无新矛盾

未发现 FR 之间、AC 之间、或 FR/AC 之间的新矛盾。MUST FIX 修复未引入副作用。

---

## 3. 修复完整性验证

### 3.1 FR5 修复前后

```
v2: "零请求...无 Badge"                          ← 矛盾根源
v3: "零请求...Badge 显示 'No Data'（muted 色）"  ← 修复
```

### 3.2 影响范围检查

修改 FR5 的零请求段后：

| 关联项 | 状态 | 说明 |
|--------|------|------|
| FR1 条件着色（`totalRequests === 0 → muted`） | ✅ 一致 | FR1 的 muted 色规则与 FR5 一致 |
| AC1 第7条（"No Data" muted） | ✅ 一致 | 未修改，与 FR5 新表述一致 |
| AC5 第1条（零请求 Badge "No Data"） | ✅ 一致 | 未修改，与 FR5 新表述一致 |
| FR5 筛选无结果段 | ✅ 一致 | 同样使用 "No Data" muted，语义一致 |
| FR5 其他段（加载中/加载失败） | ✅ 无影响 | 不涉及 Badge |

### 3.3 未修改的其他 MUST FIX

| ID | 问题 | v2 状态 | v3 状态 |
|----|------|---------|---------|
| 1 | FR3 默认值未定义三种场景 | ✅ 已修复 (v2) | ✅ 仍正确 |
| 2 | 空状态 Badge 与提示文本关系不清 | ✅ 已修复 (v2) | ✅ 仍正确 |
| 3 | Period Tabs/Select size 歧义 | ✅ 已修复 (v2) | ✅ 仍正确 |

---

## 4. 遗留问题（均为 INFO 级别，不阻塞审批）

### ID 4: Provider Select 数据源依赖标注

仍未显式标注 `providerOutputTokens` 的数据来源（`getMetricsSummary`）。`providerOutputTokens` 这个命名暗示了来源，但未显式说明。不阻塞审批，可在 plan 阶段确认。

### ID 5: AC3 自动化测试难度

"20+ Provider 时不溢出"适合手动验证测试而非自动化测试。建议在 plan 的 E2E 测试计划中标注为手动验证项。

### ID 7（新增）: AC5 未覆盖"加载失败"场景

FR5 定义了 4 种空状态（零请求、筛选无结果、加载中、加载失败），AC5 覆盖了前 3 种，缺少"加载失败"对应的验收检查项。此场景的行为为"保持当前 retry 按钮，错误文案改为具体描述"，属于增量改动而非全新功能，不阻塞 spec 审批。建议在 plan 阶段确认是否需要添加 AC 检查项。

---

## 5. 结论

**建议通过。** 上一轮的 1 条 MUST FIX（FR5 vs AC1 Badge 矛盾）已在 v3 中完全修复，未引入新矛盾或功能问题。3 个 INFO 级别遗留项不阻塞审批。

- **verdict**: pass
- **must_fix**: 0
- **resolved**: 1 MUST FIX
- **open (INFO)**: 3

---

## Summary

第3轮（最终轮）评审：MUST FIX 已修复，未引入新问题，建议通过 spec。

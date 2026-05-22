---
review:
  type: spec_review
  round: 2
  timestamp: "2026-05-23T11:00:00"
  target: ".xyz-harness/2026-05-22-dashboard-redesign/spec.md"
  verdict: fail
  summary: "第2轮评审完成，1条新MUST FIX（FR5与AC1零请求Badge显示矛盾），上一轮MUST FIX已修复"

statistics:
  total_issues: 6
  must_fix: 1
  must_fix_resolved: 1
  low: 0
  info: 2

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md:FR3"
    title: "Provider Select 默认值在 metrics 数据为空时未定义"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
    resolution: "FR3 新增三层默认值规则，覆盖 metrics 可用、metrics 为空（首次加载/全零输出/加载失败）、Provider 列表为空三种场景，边缘情况已完整定义"

  - id: 2
    severity: LOW
    location: "spec.md:FR1 / FR5 / AC5"
    title: "空状态下 'No Data' Badge 文本与 'No requests in this period' 提示文本的显示关系不清晰"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
    resolution: "FR5 已明确描述零请求显示行为（成功率"—"，无Badge，下方文案），但修复过程引入了新的FR5/AC1矛盾（见ID 6）"

  - id: 3
    severity: LOW
    location: "spec.md:FR7"
    title: "Period Tabs 和 Select 的 size 约束描述存在歧义"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
    resolution: "FR7 已明确定义'所有 Select 组件（Provider、Model、Key、Client Type）统一使用默认高度 32px'，歧义消除"

  - id: 4
    severity: INFO
    location: "spec.md:FR3"
    title: "Provider Select 默认选中逻辑依赖 getMetricsSummary 数据，但未标注此数据依赖"
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
    status: open
    raised_in_round: 2
    resolved_in_round: null

---

# 计划评审 v2

## 评审记录

- 评审时间：2026-05-23 11:00
- 评审类型：计划评审（第 2 轮）
- 评审对象：`.xyz-harness/2026-05-22-dashboard-redesign/spec.md`
- 上一轮评审：`spec_review_v1.md`（1 条 MUST FIX，2 条 LOW，2 条 INFO）

---

## 1. 上一轮 MUST FIX 验证

### ID 1: Provider Select 默认值在 metrics 数据为空时未定义 ✅ 已修复

**原问题**：spec 只规定"默认选中 token 输出量最高的 Provider"，未定义首次加载、所有 Provider 输出为零、加载失败三种边缘场景。

**当前状态**：FR3 新增三层默认值规则：

| 优先级 | 条件 | 行为 |
|--------|------|------|
| 1 | `providerOutputTokens` 非空 | 选中输出量最高的 Provider |
| 2 | metrics 数据为空（首次加载/全零输出/加载失败） | 按 `providers` 数组原始顺序选中第一个 |
| 3 | Provider 列表为空 | Select 显示 disabled，引导文案 "No providers configured..." |

**结论**：三种边缘场景均有明确行为定义，MUST FIX 已修复。✔️

---

## 2. 新发现的问题

### ID 6 (MUST FIX): FR5 与 AC1 在零请求 Badge 显示上直接矛盾

**问题描述**：FR5 和 AC1 对 `totalRequests === 0` 时的 Badge 显示给出了不同的规定：

| 来源 | 内容 | 分析 |
|------|------|------|
| **FR5 零请求段** | "Health Anchor 成功率显示 '—'（**无 Badge**），次指标全部显示 '—'" | 明确表示不显示 Badge |
| **AC1 第7条** | "请求总数为 0 时 **Badge 显示 'No Data'** 且为 muted 色" | 明确表示显示 "No Data" Badge |

这是直接的功能矛盾，实现者无法同时满足两个要求。

**建议方案**（二选一，需要在 FR 和 AC 中保持同步）：

- **方案 A（保留 Badge）**：AC1 正确，FR5 应修改为"成功率显示 '—'，Badge 显示 'No Data'（muted 色）"——与 FR1 原始设计一致
- **方案 B（去掉 Badge）**：FR5 正确，AC1 第7条应修改为"请求总数为 0 时无 Badge，成功率显示 '—'"并删除"Badge 显示 No Data"的描述

建议采用方案 A，因为：
1. AC1 的条件着色逻辑已经定义了 4 种状态（Healthy/Degraded/Critical/No Data），移除 Badge 会破坏这种对称性
2. Badge 的存在在视觉上提供了明确的状态指示，与条件着色逻辑一致
3. 修改 FR5 的一行描述即可，影响范围最小

---

## 3. 上一轮 LOW/INFO 项检查

### ID 2 (LOW) — 空状态 Badge 与提示文本关系 ⚠️ 已修复但引入新问题

FR5 已经非常清晰地描述了三种空状态的具体显示行为（零请求、筛选无结果、加载中、加载失败），每种的显示元素和文案都有明确描述。原始问题已解决。但修复过程引入了 ID 6（FR5 与 AC1 的矛盾），需一并修复。

### ID 3 (LOW) — Period Tabs 和 Select size 描述歧义 ✅ 已修复

FR7 现在明确写道：
> 所有 Select 组件（Provider、Model、Key、Client Type）统一使用默认高度 32px（不传 `size` prop）

列出所有 4 个 Select 组件，消除了歧义。

### ID 4 (INFO) — 数据源依赖标注 ❌ 仍开放

spec 仍没有明确标注 Provider 排序的数据源。`providerOutputTokens` 这个命名暗示来源于 `getMetricsSummary`，但未显式说明。可在 plan 阶段确认，不阻塞 spec 审批。

### ID 5 (INFO) — AC3 自动化测试难度 ❌ 仍开放

AC3 "20+ Provider 时不溢出"仍缺少自动化测试策略。建议在 plan 的 E2E 测试计划中标注为手动验证项。

---

## 4. 全局一致性检查

### 4.1 FR/AC 可追溯性

| FR | AC 覆盖 | 状态 |
|----|---------|------|
| FR1 Health Anchor | AC1 (8条) | ✅ 完整覆盖 |
| FR2 等宽字体 | AC2 | ✅ |
| FR3 筛选器重排 | AC3 | ✅（除边缘场景标注在 FR3 而非 AC3） |
| FR4 图表合并 | AC4 | ✅ |
| FR5 空状态 | AC5 | ⚠️ AC5 不涉及零请求 Badge（矛盾点在 AC1） |
| FR6 数据新鲜度 | AC6 | ✅ |
| FR7 DESIGN.md 合规 | AC7 | ✅ |

### 4.2 术语一致性

- "Badge" → FR1 和 AC1 中使用一致
- "Health Anchor" → FR1 定义后，FR5 引用一致
- "叠加面积图" → FR4 定义后，AC4 引用一致
- "条件着色" → FR1、FR7、AC1、AC7 中使用一致

### 4.3 无新矛盾发现

除 ID 6 外，未发现其他 FR/AC 交互的矛盾。

---

## 5. 结论

**需修改后重审**。1 条新 MUST FIX（FR5 与 AC1 零请求 Badge 矛盾）需修复。

---

## Summary

第2轮评审完成，1条新MUST FIX，需修改后重审。

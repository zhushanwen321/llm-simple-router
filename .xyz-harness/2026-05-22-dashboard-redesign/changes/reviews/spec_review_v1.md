---
review:
  type: spec_review
  round: 1
  timestamp: "2026-05-23T10:30:00"
  target: ".xyz-harness/2026-05-22-dashboard-redesign/spec.md"
  verdict: fail
  summary: "计划评审完成，第1轮，1条MUST FIX，2条LOW，2条INFO，需修改后重审"

statistics:
  total_issues: 5
  must_fix: 1
  must_fix_resolved: 0
  low: 2
  info: 2

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md:FR3 / AC3"
    title: "Provider Select 默认值在 metrics 数据为空时未定义"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 2
    severity: LOW
    location: "spec.md:FR1 / FR5 / AC5"
    title: "空状态下 'No Data' Badge 文本与 'No requests in this period' 提示文本的显示关系不清晰"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 3
    severity: LOW
    location: "spec.md:FR7"
    title: "Period Tabs 和 Select 的 size 约束描述存在歧义"
    status: open
    raised_in_round: 1
    resolved_in_round: null

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

---

# 计划评审 v1

## 评审记录

- 评审时间：2026-05-23 10:30
- 评审类型：计划评审
- 评审对象：`.xyz-harness/2026-05-22-dashboard-redesign/spec.md`

---

## 1. spec 完整性审查

### 1.1 目标明确性 ✅

目标清晰：Dashboard 改造为 Anchor + Panel 布局。Background 段提供了 critique 评分（23/40）和 6 条具体问题作为改造动机。一段话能说清要做什么。

### 1.2 范围合理性 ✅

- 范围界定清晰：限 Dashboard.vue + useDashboard.ts + i18n，不涉及后端、路由、其他页面
- "Out of Scope" 段列出了 6 条明确排除项
- Complexity Assessment 标注为中等等级并给出工作量分解，符合实际

### 1.3 验收标准可量化性 ⚠️

整体良好。AC1–AC7 多数包含可验证的行为描述（Badge 文本、颜色条件、布局方向）。但存在以下不足：

- AC3 "20+ Provider 时 Select 不溢出" 是行为描述，但在前端单元测试中难以构造 20+ 个 Provider mock（需要 mock 数据源）。更适合手动验证或用可视化回归测试覆盖
- AC7 "页面上没有非交互元素使用 text-primary" 是全局性断言，难以在自动化测试中精确覆盖（需要扫描所有元素的样式）

### 1.4 待决议项 ✅

无 `[待决议]` 或 "TBD" 标记。

---

## 2. 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | **MUST FIX** | spec.md:FR3 / AC3 | Provider Select 默认选中值在 metrics 数据为空时的行为未定义。spec 规定"默认选中 token 输出量最高的 Provider"，但未定义以下场景：首次加载（数据尚未返回）、所有 Provider 输出为零、加载失败后。这些情况下无法确定"输出量最高的 Provider"，实现存在歧义。 | 明确三个边缘场景的默认行为：(1) 数据未加载完成时默认选 "All Providers"；(2) 所有 Provider 输出为零时默认选 "All Providers"；(3) 加载失败后保持之前的选择不变。 |
| 2 | LOW | spec.md:FR1 / FR5 / AC5 | 空状态下 "No Data" Badge 文本（FR1）与 "No requests in this period" 文案（FR5）共存的显示关系不清晰。Badge 单独显示 "No Data"，同时 Anchor 区域显示 "No requests in this period"，但 spec 未说明后者是替换了请求计数字段（"12,847 requests in last 5 hours"的位置）还是额外的提示行。 | 明确"X requests in last Y hours"被替换为"No requests in this period"，Badge 保持显示 "No Data"。 |
| 3 | LOW | spec.md:FR7 | "按钮尺寸" 段的描述有歧义。原文："Period Tabs 和 Select 保持当前 size='sm'（28px），因为筛选器是辅助操作而非主要操作。Provider Select 使用默认 32px 高度。"——这里的"Select"是指已有的 Model/Key/Client Type Select，还是包括 Provider Select？后半句又说 Provider Select 用 32px，与前半句的"Select 保持 sm"矛盾。 | 重述为："Model Select、Key Select、Client Type Select 保持 size='sm'（28px）。Provider Select（替换了之前的 Button group）使用默认 32px 高度。" |
| 4 | INFO | spec.md:FR3 | Provider Select 选项按 token 输出量降序排列需要来自后端 API 的数据支持。spec 的 Constraints 列出了 `getStats`、`getMetricsSummary`、`getMetricsTimeseries`，但未明确标注 Provider 排序依赖哪个端点、哪个字段。在 plan 阶段需确认 `getMetricsSummary` 是否返回 per-provider 的 token 输出数据。 | 在 plan.md 或 spec 中标注数据源依赖关系。 |
| 5 | INFO | spec.md:AC3 | "20+ Provider 时不溢出"可手动验证（打开 Select 下拉检查 UI），但难以纳入自动化测试套件。建议标注为手动验证项。 | 可在 plan 的 E2E 测试计划中标注为手动验证。 |

---

## 3. spec 维度逐项评价

### ✅ 目标明确性

通过。Background 清晰描述了当前问题和改造动机，改造方案（Anchor + Panel）在首段即明确定义。

### ✅ 范围合理性

通过。有明确的 Out of Scope 段，边界合理。7 个 FR 覆盖了需要的改造点，无过度承诺。

### ⚠️ 验收标准可量化性

有条件通过。AC1–AC7 整体可量化，但存在 1 个 MUST_FIX 边缘场景和 2 个 INFO 可测试性问题（见上）。

### ✅ 待决议项

通过。无 `[待决议]` 标记。

---

## 4. 架构/规范合规检查

对照 CLAUDE.md 的约束，spec 声明了：

| 项目约束 | spec 合规 | 说明 |
|---------|----------|------|
| 使用 shadcn-vue 组件 | ✅ | Select 使用 shadcn-vue `<Select>` |
| 不引入新依赖 | ✅ | 明确声明"不引入新依赖" |
| 使用 composable 模式 | ✅ | useDashboard.ts 作为状态管理核心 |
| i18n 通过 t() 函数 | ✅ | Constraints 中明确要求 |
| 数组并行请求用 Promise.allSettled | ✅ | 未在 spec 范围，非问题 |
| 等宽字体用 font-mono | ✅ | FR2 明确要求 |
| 设计令牌用 oklch + CSS 变量 | ✅ | CSS 变量引用（--color-success 等） |

未发现架构/规范违规。

---

## 5. 结论

**需修改后重审**。1 条 MUST FIX 需修复（Provider Select 空数据默认行为）。

---

## Summary

计划评审完成，第1轮，1条MUST FIX，需修改后重审。

---
review:
  type: plan_review
  round: 2
  timestamp: "2026-05-23T14:00:00"
  target: ".xyz-harness/2026-05-22-/plan.md"
  verdict: fail
  summary: "计划评审完成，第2轮增量审查，1条MUST FIX（新增），需修改后重审"

statistics:
  total_issues: 4
  must_fix: 1
  must_fix_resolved: 0
  low: 2
  info: 1

issues:
  - id: 1
    severity: LOW
    location: "plan.md, Task 2 Step 8"
    title: "en i18n key 缺失未显式处理"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 2
    severity: LOW
    location: "plan.md, Task 1 Step 2"
    title: "验证命令只覆盖单文件，未指定全量回归"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 3
    severity: INFO
    location: "plan.md, Spec Metrics Traceability"
    title: "AC7 验证方式可更明确"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 4
    severity: MUST_FIX
    location: "plan.md, Task 2 Steps 4+5+6"
    title: "默认 form 值与 Select option value 不匹配，违反 AC4"
    status: open
    raised_in_round: 2
    resolved_in_round: null
---

# 计划评审 v2（增量审查）

## 评审记录
- 评审时间：2026-05-23 14:00
- 评审类型：计划评审（增量审查 v2）
- 评审对象：`.xyz-harness/2026-05-22-/plan.md`

---

## 增量审查说明

本次为第 2 轮增量审查。v1 评审（0 条 MUST FIX，verdict: pass）后，v1 的 LOW 和 INFO 问题无需在增量模式中重新评估。本报告聚焦新增 MUST FIX 问题。

---

## 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 4 | **MUST FIX** | plan.md, Task 2 Steps 4+5+6 | **form 默认值与 Select option 不匹配，违反 AC4**。Step 5 使用 `<SelectItem value="__all__">` 作为"通用"选项，但 Step 4 中 `createDefaultForm()` 返回 `provider_id: null`，Step 6 中 watch 设置 `form.value = { ...rule, provider_id: null, ... }`。Select 的 `v-model="form.provider_id"` 收到 `null`，而所有 SelectItem 的 value 要么是 `"__all__"` 要么是 provider ID 字符串。`null !== "__all__"`，所以 Select 无法匹配任何选项，会显示 placeholder 文本而非"通用"，直接违反 AC4（"弹窗打开时 provider 默认选中'通用（所有供应商）'"）。 | 四步修改：(1) Step 4 `createDefaultForm()` 返回 `provider_id: "__all__" as string \| null`；(2) Step 6 watch 中改为 `form.value = { ...rule, provider_id: "__all__", is_active: true }`；(3) Step 3 `RuleFormData` 类型标注 `provider_id: string \| null` 即可（`"__all__"` 是 sting 的子集，无需单独标注）；(4) Step 7 的 save 逻辑不变（`"__all__"` → `null` 映射已在 Step 7 handle）。 |
| 1 | LOW | plan.md, Task 2 Step 8 | en i18n key 缺失未显式处理（v1 遗留，未变） | — |
| 2 | LOW | plan.md, Task 1 Step 2 | 验证命令只覆盖单文件，未指定全量回归（v1 遗留，未变） | — |
| 3 | INFO | plan.md, Spec Metrics Traceability | AC7 验证方式可更明确（v1 遗留，未变） | — |

### 新增 MUST FIX 详细说明

#### Issue #4: form 默认值 `null` 与 Select option `"__all__"` 不匹配

**问题路径追踪：**

```
Step 4: createDefaultForm() → provider_id: null          ← form 初始值 = null
Step 5: SelectItem value="__all__"                        ← Select 选项值 = "__all__"
Step 6: watch() → form.value = { ...rule, provider_id: null }  ← watch 重置 form，provider_id = null
Step 7: save → provider_id === "__all__" ? null : ...     ← 期望 form.provider_id 可能是 "__all__"
        → null === "__all__" → false → (null || null) → null  ← 即使传 null 也能工作，但表现层错误
```

**表现层后果：**

Select 组件的 `v-model` 绑定 `form.provider_id`。当该值为 `null` 时，没有 `<SelectItem>` 的 value 等于 `null`（唯一接近的是 `"__all__"`，但字符串 `"__all__"` !== `null`）。shadcn-vue/radix-vue 的 Select 在这种情况下会显示 placeholder 文本（`SelectValue :placeholder`），而不是"通用"。用户看到的是 placeholder 占位符，违背了 AC4 关于默认选中"通用"的要求。

**为什么是 MUST FIX 不是 LOW：**

AC4 是 spec 中明确的验收标准，属于需求核心目标。该问题会导致功能表现不正确（用户看不到默认选中的"通用"），符合等级判定校准规则中的"功能失效"定义。不是预存代码质量问题。

**修改方向：**

将 form 默认值从 `null` 改为 `"__all__"`，与 Select option value 一致：

- `createDefaultForm()`: `provider_id: "__all__" as string | null`
- watch 中: `form.value = { ...rule, provider_id: "__all__", is_active: true }`
- `RuleFormData`: `provider_id: string | null`（无需改动，`"__all__"` 是 string 子集）
- 保存逻辑不变（Step 7 handle 已正确处理 `"__all__"` → `null`）

---

## 结论

**需修改后重审。** 1 条 MUST FIX（新增），核心问题是 Task 2 中 form 默认值 `null` 与 Select option value `"__all__"` 不匹配，会导致弹窗打开时 provider 下拉选择器无法正确显示默认选中"通用"，违反 AC4。

修复以上 MUST FIX 后 verdict 可转为 pass。

---

## Summary

计划评审完成，第2轮增量审查，1条MUST FIX（新增），需修改后重审。

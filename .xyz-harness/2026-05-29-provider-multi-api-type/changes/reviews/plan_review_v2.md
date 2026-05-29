---
review:
  type: plan_review
  round: 2
  timestamp: "2026-05-29T21:30:00"
  target: ".xyz-harness/2026-05-29-provider-multi-api-type/plan.md"
  verdict: fail
  summary: "第2轮评审，5条MUST FIX中#2已完全修复，#1/#3/#4/#5部分修复——plan.md/interface_chain.json已更新但plan-backend.md和plan-api-contract.md仍有残留矛盾，需统一"

statistics:
  total_issues: 9
  must_fix: 4
  must_fix_resolved: 1
  low: 4
  info: 0

issues:
  - id: 1
    severity: MUST_FIX
    location: "plan-backend.md §1.4 + plan-api-contract.md parseEndpoints Error Cases"
    title: "parseEndpoints 对非法 JSON 的行为仍与 plan.md/interface_chain.json 矛盾（#1 残留）"
    status: open
    raised_in_round: 2
    resolved_in_round: null
    detail: |
      plan.md Interface Contracts: "invalid JSON → throw" ✅
      interface_chain.json: "invalid JSON → throws" ✅
      plan-backend.md §1.4: "非法 JSON → console.warn + 返回 []" ❌
      plan-api-contract.md Error Cases: "非法 JSON | [] + console.warn | 数据损坏，防御性返回空" ❌
      
      四份文档对同一函数的边界行为仍有两派：plan.md + interface_chain.json 说 throw，plan-backend.md + plan-api-contract.md 说 return []。Subagent 按 plan-backend.md 实现会返回空数组，而按 plan.md 测试会期望 throw——执行时必然冲突。
  - id: 2
    severity: MUST_FIX
    location: "plan-backend.md §2.4"
    title: "§2.4 仍写「同一迁移文件中追加」，与 plan.md 的两文件方案矛盾（#3 残留）"
    status: open
    raised_in_round: 2
    resolved_in_round: null
    detail: |
      plan.md File Structure 已正确列出 051_add_endpoints.sql (BG1) + 052_add_upstream_log_fields.sql (BG3)。
      但 plan-backend.md §2.4 标题仍为"同一迁移文件中追加"，内容将 request_logs ALTER TABLE 放在 051 中。
      Subagent 按 plan-backend.md 执行时会将 ALTER TABLE 追加到 051，与 plan.md 和 BG3 subagent 的 052 创建冲突。
  - id: 3
    severity: MUST_FIX
    location: "plan.md BG3 Subagent 配置"
    title: "BG3 Subagent「修改/创建文件」列表仍缺少 db/logs.ts 和 admin/logs.ts（#4 残留）"
    status: open
    raised_in_round: 2
    resolved_in_round: null
    detail: |
      plan.md File Structure 已包含 db/logs.ts 和 admin/logs.ts ✅。
      但 BG3 Subagent 配置的"修改/创建文件"仍为"上述 4 文件 + 052 migration"，缺少这两个文件。
      "读取文件"列表也缺少这两个文件。
      "Files (预估)"仍为"6 个（1 create + 5 modify）"，应为"7 个（1 create + 6 modify）"。
      
      后果：BG3 subagent 不会触碰 db/logs.ts 和 admin/logs.ts，日志新字段的 DB 写入和 Admin API 返回链路断裂。
  - id: 4
    severity: MUST_FIX
    location: "plan-backend.md §1.3 + §6"
    title: "resolveEndpoint 文件位置仍标注为 providers.ts，与 plan.md 的 resolve-endpoint.ts 矛盾（#5 残留）"
    status: open
    raised_in_round: 2
    resolved_in_round: null
    detail: |
      plan.md File Structure: resolveEndpoint 在 resolve-endpoint.ts ✅
      interface_chain.json: module="resolve-endpoint", note="imports parseEndpoints from providers.ts" ✅
      plan-backend.md §1.3: "文件: router/src/db/providers.ts（新增函数）" ❌
      plan-backend.md §6: resolveEndpoint 列在 "Module: providers (DB 层)" 下 ❌
      
      Subagent 按 plan-backend.md 执行会将 resolveEndpoint 写入 providers.ts 而非 resolve-endpoint.ts。
  - id: 5
    severity: LOW
    location: "plan-backend.md §2.1 migration SQL"
    title: "UPDATE 语句有一个多余的右括号"
    status: open
    raised_in_round: 2
    resolved_in_round: null
    detail: |
      json_array(json_object(...)) 正确闭合后，还有一个多余的 `)` 在 WHERE 之前。
      运行时会报 SQL syntax error。建议删除多余的右括号。
  - id: 6
    severity: LOW
    location: "plan.md Interface Contracts Module 标题"
    title: "parseEndpoints 列在 Module: resolve-endpoint 下，但实际在 providers.ts"
    status: open
    raised_in_round: 2
    resolved_in_round: null
    detail: |
      plan.md Interface Contracts 的 "Module: resolve-endpoint" 章节同时列出 resolveEndpoint 和 parseEndpoints。
      parseEndpoints 实际在 providers.ts（DB 层），不属于 resolve-endpoint 模块。
      建议拆分为两个 Module 章节，或加注释说明 parseEndpoints 从 providers.ts 导入。
  - id: 7
    severity: LOW
    location: "plan.md File Structure FG1 行"
    title: "FG1 仍缺少多个前端文件（#7 残留，Round 1 LOW 未修复）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
    detail: |
      缺少: useProviderPresets.ts, api/client.ts, logs/types.ts, request-detail/types.ts, 4个i18n JSON。
      FG1 "Files (预估)" 仍为 "10 个"，实际应为 ~15 个。
      plan-frontend.md §6 列出了全部 18 个文件，但 plan.md 只列了 9 个。
  - id: 8
    severity: LOW
    location: "plan-backend.md §4.1"
    title: "failover-loop.ts 行号硬编码（#8 残留，Round 1 LOW 未修复）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 9
    severity: LOW
    location: "plan-frontend.md §3.4"
    title: "preset.dualProtocol 字段无后端数据源（#6 残留，Round 1 LOW 未修复）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# 计划评审 v2

## 评审记录
- 评审时间：2026-05-29 21:30
- 评审类型：计划评审（第 2 轮验证）
- 评审对象：`plan.md` + `plan-backend.md` + `plan-api-contract.md` + `interface_chain.json`（均已更新）
- 评审轮次：第 2 轮
- 评审重点：验证 Round 1 的 5 条 MUST FIX 修复情况

---

## 1. Round 1 MUST FIX 修复验证

### ✅ #2: Migration SQL（已修复）

**原问题**: 使用 `json_group_array`（聚合函数）构造 JSON 数组。
**修复状态**: 已改为 `json_array(json_object(...))`，正确使用标量函数。✅

**新发现**: UPDATE 语句有一个多余的右括号（Issue #5），标为 LOW。

### ⚠️ #1: parseEndpoints 行为统一（部分修复）

**已修复**: `null → []` 在四份文档中已统一。✅
**未修复**: 非法 JSON 的行为仍分两派：

| 文档 | 非法 JSON 行为 |
|------|--------------|
| plan.md Interface Contracts | throw |
| interface_chain.json | throws |
| plan-backend.md §1.4 | console.warn + return [] |
| plan-api-contract.md Error Cases | [] + console.warn |

plan.md 和 interface_chain.json 已统一为 "throw"，但 plan-backend.md §1.4 和 plan-api-contract.md 仍保留旧的 "console.warn + return []" 描述。需要后两者也改为 throw 以匹配。

### ⚠️ #3: 迁移文件数量（部分修复）

**已修复**: plan.md File Structure 正确列出 051 (BG1) + 052 (BG3) 两个文件。✅
**未修复**: plan-backend.md §2.4 仍写"同一迁移文件中追加"，与 plan.md 矛盾。需要改为引用 052 独立文件。

### ⚠️ #4: BG3 缺少 db/logs.ts 和 admin/logs.ts（部分修复）

**已修复**: plan.md File Structure 已包含这两个文件。✅
**未修复**: BG3 Subagent 配置的"修改/创建文件"列表仍缺少这两个文件，"读取文件"列表也缺少，"Files (预估)"仍为 6 而非 7。需要更新 BG3 subagent 配置。

### ⚠️ #5: parseEndpoints/resolveEndpoint 文件位置（部分修复）

**已修复**: plan.md File Structure 和 interface_chain.json 已正确定位。✅
**未修复**: plan-backend.md §1.3 仍将 resolveEndpoint 标注为在 providers.ts，§6 接口签名表将 resolveEndpoint 列在 "Module: providers (DB 层)" 下。需要改为 resolve-endpoint.ts。

---

## 2. 整体评估

### 修复模式分析

所有 5 条 MUST FIX 的修复模式一致：**plan.md + interface_chain.json 已更新，但 plan-backend.md 和 plan-api-contract.md 未同步更新**。这导致主文档和子文档之间仍有残留矛盾。

### 影响分析

残留矛盾的实际影响：
- **Issue #1**（parseEndpoints 非法 JSON）：BG1 subagent 按 plan-backend.md 实现会返回 []，但 plan.md 测试期望 throw → TDD 阶段测试失败
- **Issue #2**（迁移文件）：BG3 subagent 按 plan-backend.md 会将 ALTER TABLE 追加到 051，而 plan.md 和 BG3 config 期望独立 052 → 迁移文件冲突
- **Issue #3**（BG3 缺文件）：BG3 subagent 不会修改 db/logs.ts 和 admin/logs.ts → FR-5 链路断裂
- **Issue #4**（resolveEndpoint 位置）：BG1 subagent 按 plan-backend.md 会将 resolveEndpoint 写入 providers.ts → 文件结构与 plan.md 不一致

### 好的方面

- plan.md 本身质量高，File Structure、Execution Groups、Interface Contracts 逻辑自洽
- interface_chain.json 与 plan.md 完全一致，包含 import 关系说明
- 架构方向正确（endpoints JSON + resolveEndpoint 封装 + 四层不变）
- spec 覆盖矩阵完整，AC 覆盖无遗漏
- 非功能性设计合理（幂等迁移、防御性 fallback、双写一致性）

---

## 3. 修复建议

### 批量修复方案

所有 4 条残留 MUST FIX 都集中在 plan-backend.md 和 plan-api-contract.md 中，可一次修复：

**plan-backend.md**:
1. §1.4: "非法 JSON → console.warn + 返回 []" → "非法 JSON → throw Error('Invalid endpoints JSON')"
2. §2.4: "同一迁移文件中追加" → 独立 §2.4 标题改为 "Migration 052 SQL"，引用 `052_add_upstream_log_fields.sql`
3. §1.3: "文件: router/src/db/providers.ts" → "文件: router/src/proxy/routing/resolve-endpoint.ts"
4. §6: resolveEndpoint 从 "Module: providers (DB 层)" 移到新章节 "Module: resolve-endpoint (代理层)"
5. §2.1: 删除 UPDATE 语句多余的右括号

**plan.md**:
1. BG3 Subagent "修改/创建文件": 追加 `src/db/logs.ts`, `src/admin/logs.ts`
2. BG3 Subagent "读取文件": 追加 `src/db/logs.ts`, `src/admin/logs.ts`
3. BG3 "Files (预估)": "6 个" → "7 个（1 create + 6 modify）"

**plan-api-contract.md**:
1. parseEndpoints Error Cases: "非法 JSON | [] + console.warn" → "非法 JSON | throw Error"

---

## 结论

4 条 MUST FIX 残留，均为主文档已更新但子文档未同步。修复范围集中（plan-backend.md 5 处 + plan.md 3 处 + plan-api-contract.md 1 处），预计 15 分钟内可完成。建议批量修复后进入第 3 轮验证。

### Summary

计划评审第2轮。Round 1 的 5 条 MUST FIX 中 #2 已完全修复，#1/#3/#4/#5 部分修复——plan.md 和 interface_chain.json 已正确更新，但 plan-backend.md 和 plan-api-contract.md 存在残留矛盾。4 条 MUST FIX 需继续修复。

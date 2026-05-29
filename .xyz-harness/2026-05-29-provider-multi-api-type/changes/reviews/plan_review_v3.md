---
review:
  type: plan_review
  round: 3
  timestamp: "2026-05-29T22:00:00"
  target: ".xyz-harness/2026-05-29-provider-multi-api-type/plan.md"
  verdict: fail
  summary: "第3轮评审（最终轮），v2 的 4 条 MUST FIX 中 #1 #2 已完全修复，#3 #4 仍部分修复。新发现 §5.1 引用错误迁移文件、resolveEndpoint 空数组行为跨文档矛盾。共 4 条 MUST FIX 需继续修复"

statistics:
  total_issues: 9
  must_fix: 4
  must_fix_resolved: 2
  low: 5
  info: 0

issues:
  - id: 1
    severity: MUST_FIX
    location: "plan.md BG3 Subagent 配置「修改/创建文件」+「Files (预估)」"
    title: "BG3「修改/创建文件」仍缺少 db/logs.ts 和 admin/logs.ts，「Files (预估)」仍为 6（#3 残留）"
    status: open
    raised_in_round: 3
    resolved_in_round: null
    detail: |
      「读取文件」已包含 db/logs.ts + admin/logs.ts ✅。
      但「修改/创建文件」仍为 "上述 4 文件 + 052 migration"——仅涵盖 failover-loop.ts / patch/index.ts / transport-fn.ts / log-helpers.ts，不包含 db/logs.ts 和 admin/logs.ts。
      「Files (预估)」仍为 "6 个（1 create + 5 modify）"，应为 "7 个（1 create + 6 modify）"。
      
      后果：BG3 subagent 读到 db/logs.ts 和 admin/logs.ts 但修改指令不含这两个文件，FR-5 链路（DB INSERT + Admin API 响应）断裂。
  - id: 2
    severity: MUST_FIX
    location: "plan-backend.md §1.3 + §6"
    title: "resolveEndpoint 文件位置仍标注为 providers.ts，与 plan.md resolve-endpoint.ts 矛盾（#4 残留）"
    status: open
    raised_in_round: 3
    resolved_in_round: null
    detail: |
      §7 AC 覆盖矩阵已改为 resolve-endpoint.ts ✅。
      但 §1.3 函数签名上方仍写 "文件: router/src/db/providers.ts（新增函数）" ❌。
      §6 接口签名表仍将 resolveEndpoint 列在 "Module: providers (DB 层)" 下 ❌。
      
      BG1 subagent 按 §1.3（主设计节）实现会将 resolveEndpoint 写入 providers.ts，与 plan.md File Structure 的 resolve-endpoint.ts 冲突。
  - id: 3
    severity: MUST_FIX
    location: "plan-backend.md §5.1"
    title: "§5.1 仍写「Migration 051 已包含」上游日志列，与 §2.4 的独立 052 矛盾（#2 修复引入）"
    status: open
    raised_in_round: 3
    resolved_in_round: null
    detail: |
      §2.4 已正确改为 "单独迁移文件 052_add_upstream_log_fields.sql" ✅。
      但 §5.1 标题下方仍写 "Migration 051 已包含"，列出了 upstream_api_type 和 upstream_base_url。
      
      BG3 subagent 按 §5.1 会去 051 文件中找/添加这些列，与 §2.4 的 052 方案冲突，可能导致重复 ALTER TABLE 或列遗漏。
  - id: 4
    severity: MUST_FIX
    location: "plan.md Interface Contracts + interface_chain.json vs plan-backend.md §1.3 行为表 #9 + 伪代码"
    title: "resolveEndpoint 对空 endpoints 行为跨文档矛盾：plan.md/interface_chain.json 说 throw，plan-backend.md 说 fallback（v1 #1 遗留维度）"
    status: open
    raised_in_round: 3
    resolved_in_round: null
    detail: |
      plan.md Interface Contracts: "parseEndpoints returns [] → throw" 
      interface_chain.json: "endpoints null/empty → throws"
      plan-backend.md §1.3 行为表 #9: "防御性 fallback" → 用旧字段
      plan-backend.md §1.3 伪代码: "if endpoints.length === 0: return { fallback }"
      
      四份文档对 resolveEndpoint 空 endpoints 的处理分两派。TDD subagent 按 plan.md 写测试期望 throw，实现 subagent 按 plan-backend.md 写 fallback——测试必然失败。
  - id: 5
    severity: LOW
    location: "plan-backend.md §2.1 UPDATE SQL"
    title: "UPDATE 语句仍有多余右括号（v2 #5 未修复）"
    status: open
    raised_in_round: 2
    resolved_in_round: null
    detail: |
      json_array(json_object(...)) 正确闭合后，WHERE 前有一个多余的 `)`。运行时报 SQL syntax error。删除即可。
  - id: 6
    severity: LOW
    location: "plan.md Interface Contracts Module 标题"
    title: "parseEndpoints 列在 Module: resolve-endpoint 下，但实际定义在 providers.ts（v2 #6 未修复）"
    status: open
    raised_in_round: 2
    resolved_in_round: null
  - id: 7
    severity: LOW
    location: "plan.md File Structure FG1 行"
    title: "FG1 文件数仍为 10，缺少 i18n JSON + useProviderPresets.ts（v1 #7 未修复）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 8
    severity: LOW
    location: "plan-backend.md §4.1"
    title: "failover-loop.ts 行号硬编码（v1 #8 未修复）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 9
    severity: LOW
    location: "plan-frontend.md §3.4"
    title: "preset.dualProtocol 字段无后端数据源（v1 #6 未修复）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# 计划评审 v3（最终轮）

## 评审记录
- 评审时间：2026-05-29 22:00
- 评审类型：计划评审（第 3 轮，最终轮）
- 评审对象：`plan.md` + `plan-backend.md` + `plan-api-contract.md` + `interface_chain.json`
- 评审轮次：第 3 轮
- 评审重点：验证 v2 的 4 条 MUST FIX 修复情况，并发现修复引入的新问题

---

## 1. v2 MUST FIX 逐项验证

### ✅ v2 #1: parseEndpoints 非法 JSON 行为（已完全修复）

| 文档 | 修复前 | 当前 | 状态 |
|------|--------|------|------|
| plan.md Interface Contracts | throw | "invalid JSON → throw" | ✅ |
| interface_chain.json | throws | "invalid JSON → throws" | ✅ |
| plan-backend.md §1.4 | console.warn + return [] | "非法 JSON → throw Error" | ✅ |
| plan-api-contract.md Error Cases | [] + console.warn | "非法 JSON → throw Error" | ✅ |

四份文档完全一致。**彻底修复。**

### ✅ v2 #2: 迁移文件分离（已完全修复）

| 位置 | 修复前 | 当前 | 状态 |
|------|--------|------|------|
| plan-backend.md §2.4 | "同一迁移文件中追加" | "单独迁移文件 `052_add_upstream_log_fields.sql`（与 051 分离，职责单一）" | ✅ |
| plan.md File Structure | 051+052 两文件 | 051_add_endpoints.sql (BG1) + 052_add_upstream_log_fields.sql (BG3) | ✅ |

**但**：§2.4 修复后，§5.1 未同步更新，引入新的不一致（见 Issue #3）。

### ⚠️ v2 #3: BG3 文件列表（部分修复）

| 位置 | 修复前 | 当前 | 状态 |
|------|--------|------|------|
| plan.md BG3「读取文件」 | 缺 db/logs.ts + admin/logs.ts | 已包含 | ✅ |
| plan.md BG3「修改/创建文件」 | "上述 4 文件 + 052" | **未变**——仍为 "上述 4 文件 + 052" | ❌ |
| plan.md BG3「Files (预估)」 | "6 个" | **未变**——仍为 "6 个（1 create + 5 modify）" | ❌ |
| plan.md File Structure 表 | 缺两行 | 已包含 db/logs.ts + admin/logs.ts | ✅ |

**残留问题**：「修改/创建文件」说 "上述 4 文件"，仅指 failover-loop.ts / patch/index.ts / transport-fn.ts / log-helpers.ts。db/logs.ts 和 admin/logs.ts 在「读取文件」中但不在「修改/创建」指令中。subagent 会读但不改，FR-5 链路断裂。

### ⚠️ v2 #4: resolveEndpoint 文件位置（部分修复）

| 位置 | 修复前 | 当前 | 状态 |
|------|--------|------|------|
| plan.md File Structure | 矛盾 | resolve-endpoint.ts | ✅ |
| interface_chain.json | 矛盾 | module="resolve-endpoint" | ✅ |
| plan-backend.md §7 AC 矩阵 | providers.ts | resolve-endpoint.ts | ✅ |
| plan-backend.md §1.3 | providers.ts | **未变**——"文件: router/src/db/providers.ts（新增函数）" | ❌ |
| plan-backend.md §6 | "Module: providers (DB 层)" | **未变**——resolveEndpoint 仍在 providers 模块下 | ❌ |

**残留问题**：§1.3 是主设计节，subagent 优先参考。§6 是接口签名表，直接影响代码组织。两处仍指向 providers.ts。

---

## 2. 新发现的问题

### Issue #3: §5.1 引用错误迁移文件（§2.4 修复引入）

**plan-backend.md §5.1**:
> Migration 051 已包含:
> - upstream_api_type TEXT DEFAULT NULL
> - upstream_base_url TEXT DEFAULT NULL

**plan-backend.md §2.4**（已修复）:
> 单独迁移文件 `052_add_upstream_log_fields.sql`

§2.4 修复后 §5.1 未同步，指向错误的迁移文件。BG3 subagent 按 §5.1 会去 051 找或追加列，与 §2.4 和 BG3 File Structure 的 052 方案冲突。

### Issue #4: resolveEndpoint 空数组行为跨文档矛盾（v1 #1 遗留维度）

v1 #1 覆盖了 parseEndpoints 的两类边界：(a) 非法 JSON、(b) resolveEndpoint 收到空数组。v2 和本轮修复聚焦于 (a)，但 (b) 仍有矛盾：

| 文档 | 空 endpoints 行为 |
|------|-----------------|
| plan.md Interface Contracts | "parseEndpoints returns [] → **throw**" |
| interface_chain.json | "endpoints null/empty → **throws**" |
| plan-backend.md §1.3 行为表 #9 | "**防御性 fallback**" → 用旧字段 |
| plan-backend.md §1.3 伪代码 | `if endpoints.length === 0: return { fallback }` |

TDD subagent 按 plan.md 写测试期望 throw，实现 subagent 按 plan-backend.md 实现 fallback——测试必然失败。需统一。

**建议**：统一为 fallback（与 plan-backend.md 实现一致），更新 plan.md 和 interface_chain.json。理由：迁移后的正常 Provider 永远不会有空 endpoints，fallback 是纯防御性处理，不应中断用户请求。

---

## 3. LOW 级问题追踪

| # | 来源 | 描述 | 状态 |
|---|------|------|------|
| 5 | v2 #5 | §2.1 UPDATE SQL 多余右括号 | 未修复 |
| 6 | v2 #6 | parseEndpoints 列在 Module: resolve-endpoint 下，实际在 providers.ts | 未修复 |
| 7 | v1 #7 | FG1 文件数 ~15 vs 列出 10 | 未修复 |
| 8 | v1 #8 | failover-loop.ts 行号硬编码 | 未修复 |
| 9 | v1 #6 | preset.dualProtocol 无后端数据源 | 未修复 |

---

## 4. 修复清单（预计 10 分钟）

### plan.md (3 处)

1. BG3「修改/创建文件」: "上述 4 文件 + 052" → 显式列出全部 6 个 modify 文件 + 052 create
2. BG3「Files (预估)」: "6 个（1 create + 5 modify）" → "7 个（1 create + 6 modify）"
3. Interface Contracts resolveEndpoint Edge Cases: "parseEndpoints returns [] → throw" → "parseEndpoints returns [] → fallback to legacy fields"（与 plan-backend.md 统一）

### plan-backend.md (4 处)

1. §1.3 文件标注: "router/src/db/providers.ts" → "router/src/proxy/routing/resolve-endpoint.ts"
2. §5.1: "Migration 051 已包含" → "Migration 052 已包含"
3. §6: resolveEndpoint 从 "Module: providers (DB 层)" 移至 "Module: resolve-endpoint (路由层)"
4. §2.1: 删除 UPDATE 语句多余右括号

### interface_chain.json (1 处)

1. resolveEndpoint edgeCases: "endpoints null/empty → throws" → "endpoints null/empty → fallback to legacy fields"

---

## 结论

v2 的 4 条 MUST FIX 中，#1（parseEndpoints 非法 JSON）和 #2（迁移文件分离）已完全修复。#3 和 #4 仍部分修复（plan.md 已更新，但 subagent 配置和 plan-backend.md 设计节未同步）。修复 #2 引入了 §5.1 新矛盾。v1 #1 的 resolveEndpoint 空数组维度从未被显式修复。

4 条 MUST FIX 均为文档间一致性残余，修复范围明确（plan.md 3 处 + plan-backend.md 4 处 + interface_chain.json 1 处），不涉及架构调整。

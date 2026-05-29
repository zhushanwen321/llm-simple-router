---
verdict: fail
must_fix: 2
reviewer: independent-expert
round: 4
date: 2026-05-29
---

# Plan Review v4 — Final Consistency Check

## Verification Checklist

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | resolveEndpoint 只在 resolve-endpoint.ts，不在 providers.ts | ✅ PASS | plan-backend.md §1.3 明确声明文件为 `routing/resolve-endpoint.ts`；plan.md File Structure 同；interface_chain.json `"class": "resolve-endpoint"`；§6 模块表归入 resolve-endpoint 模块 |
| 2 | parseEndpoints 在 providers.ts（DB 层） | ✅ PASS | plan-backend.md §1.4 声明 `db/providers.ts`；interface_chain.json `"class": "providers"`；plan.md BG1 subagent 配置写入 `src/db/providers.ts` |
| 3 | 迁移文件 051 + 052 分离 | ⚠️ PARTIAL | plan.md File Structure 和 §2.4 正确分离为两个文件；但 §8 影响文件列表只有 051 且描述合并了两者的内容（见 MUST FIX #2） |
| 4 | parseEndpoints：null→空数组，非法JSON→throw | ✅ PASS | 四份文档一致：plan-backend.md §1.4、plan.md Interface Contracts、interface_chain.json、plan-api-contract.md 均为 null→`[]`、非法→throw |
| 5 | resolveEndpoint：空数组→throw | ❌ FAIL | 伪代码/plan.md/interface_chain.json 均为 throw；但行为表 row #9、§9 稳定性、api-contract 仍写 fallback（见 MUST FIX #1） |
| 6 | BG3 Files 包含 db/logs.ts + admin/logs.ts | ✅ PASS | plan.md File Structure 两行均标注 BG3；BG3 subagent 配置读取/修改文件列表均包含两者 |
| 7 | interface_chain.json 有 version + class 字段 | ✅ PASS | 顶层 `"version": "1.0.0"`；每个 method 含 `"class"` 字段：`resolve-endpoint`、`providers`、`admin-providers` |

## MUST FIX #1: resolveEndpoint 空数组行为 — 三处残留 fallback 描述

**严重度**: 高 — 核心函数行为在文档内部自相矛盾，实现者无法判断应 throw 还是 fallback。

**矛盾矩阵**:

| 位置 | 描述 | 行为 |
|------|------|------|
| plan-backend.md §1.3 伪代码 (L78-79) | `throw new Error(...)` | **throw** |
| plan-backend.md §1.3 边界条件 (L102) | "throw Error" | **throw** |
| plan-backend.md §2.3 幂等保护 (L184) | "resolveEndpoint() 对空数组 throw" | **throw** |
| plan-backend.md §6 模块表 (L542) | "空 endpoints → throw Error" | **throw** |
| plan.md Interface Contracts | "parseEndpoints returns [] → throw" | **throw** |
| interface_chain.json | "endpoints null/empty → throws" | **throw** |
| **plan-backend.md §1.3 行为表 row #9** (L70) | "防御性 fallback" | **fallback** ❌ |
| **plan-backend.md §9 稳定性** (L675) | "防御性 fallback，不会因数据异常崩溃" | **fallback** ❌ |
| **plan-api-contract.md Error Cases** (L387) | "fallback 到旧字段 provider.api_type/..." | **fallback** ❌ |

6 处 throw vs 3 处 fallback。伪代码和 interface_chain.json 是最权威的行为规范，应以 throw 为准。

**修复要求**:

1. **plan-backend.md §1.3 行为表 row #9**: 将"防御性 fallback"改为 "throw Error('Provider has no endpoints')"，删除"用旧字段"描述
2. **plan-backend.md §9 稳定性**: 将"resolveEndpoint() 对空 endpoints 有防御性 fallback，不会因数据异常崩溃"改为 "resolveEndpoint() 对空 endpoints 抛出 Error，调用方应捕获并返回适当错误响应"
3. **plan-api-contract.md resolveEndpoint Error Cases**: 将"fallback 到旧字段"行改为 "throw Error('Provider {id} has no endpoints')"，触发条件保留"迁移未执行或 endpoints 被手动清空"

## MUST FIX #2: §8 影响文件列表 — 051 描述越界 + 缺 052 行

**严重度**: 中 — §8 是实现者的快速参考，错误描述会误导文件拆分决策。

**现状**:

§8 只有一行迁移文件：
```
router/src/db/migrations/051_provider_endpoints.sql | create | ALTER TABLE + 数据迁移 + request_logs 新增列
```

**问题**:
1. 051 描述包含 "request_logs 新增列"，但这是 052 的职责（§2.4 明确拆分："单独迁移文件 052_add_upstream_log_fields.sql（与 051 分离，职责单一）"）
2. 缺少 `052_add_upstream_log_fields.sql` 独立行

**修复要求**:

将 §8 的 051 行改为：

```
| `router/src/db/migrations/051_provider_endpoints.sql` | create | ALTER TABLE providers ADD endpoints + 旧字段数据迁移 |
```

新增 052 行：

```
| `router/src/db/migrations/052_add_upstream_log_fields.sql` | create | ALTER TABLE request_logs ADD upstream_api_type + upstream_base_url |
```

## Non-MUST-FIX Observations

### N1: plan-backend.md §8 缺少 admin/logs.ts

§5.5 数据消费者检查明确列出 `admin/logs.ts`（日志详情返回需追加字段），BG3 subagent 配置也包含它。但 §8 影响文件列表没有 `admin/logs.ts` 行。

**建议**: 在 §8 新增 `router/src/admin/logs.ts | modify | 日志详情响应追加 upstream_api_type + upstream_base_url 字段`。

### N2: plan.md AC 覆盖矩阵中 AC-10 任务分配

plan.md Spec Coverage Matrix 将 AC-10 (upstream_path 覆盖) 分配给 Task 1，但 plan-backend.md §7 AC 矩阵将其分配给 Task 3 (resolveEndpoint 运行时)。Task 1 是数据基础层（类型+迁移），Task 3 才是代理层适配（failover-loop 集成）。后者更准确，因为 upstream_path 的实际使用发生在 failover-loop.ts 中。

**影响**: 低 — 实现时 subagent 按 plan-backend.md 执行即可，plan.md 的 Task 分配仅作参考。

## Verdict

**FAIL** — 2 个 MUST FIX。

MUST FIX #1（空数组行为 fallback 残留）是核心逻辑歧义，必须在编码前消除。MUST FIX #2（§8 迁移文件描述）是影响文件列表与 §2.4 / plan.md 的交叉不一致。两者修复量均 < 5 行。

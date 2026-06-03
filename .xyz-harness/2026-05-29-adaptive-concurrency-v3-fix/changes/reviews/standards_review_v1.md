---
verdict: pass
must_fix: 0
review_metrics:
  files_reviewed: 2
  lines_changed: 120
  checks_performed: 14
  must_fix_count: 0
  should_fix_count: 1
  nitpick_count: 1
  phase: "B: CLAUDE.md 编码规范检查"
  auto_lint_phase: "A: PASS (0 error, 0 warning)"
---

# Standards Review V1 — Adaptive Concurrency V3

**审查范围：** `router/src/core/concurrency/adaptive-controller.ts` + `types.ts`
**变更类型：** 算法简化（V2→V3：移除 limitReached/keepRatio/wasQueued 利用率门控，简化为纯计数器 + 冷却期翻转语义）

## Phase A: 自动 Lint ✅

| 检查项 | 结果 |
|--------|------|
| ESLint (0 error, 0 warning) | PASS |
| TypeScript 编译 | PASS（tsc 通过） |
| no-explicit-any | PASS — 无 any |
| no-magic-numbers | PASS — 所有数字提取为命名常量 |
| taste/no-silent-catch | PASS — 无 catch 块 |
| taste/no-unbounded-while-true | PASS — 无 while(true) |
| taste/no-raw-json-parse-models | PASS — 无 JSON.parse |
| taste/no-eslint-disable | PASS — 无 eslint-disable 注释 |

## Phase B: CLAUDE.md 编码规范逐项检查

### B1. 兜底响应 ✅

**不适用** — 此模块不是 HTTP handler，无 catch/switch default/response 对象。所有方法操作内部状态机，通过 `syncToSemaphore()` 传播变更。分支结构完整：
- `onRequestComplete()`: success → `transitionSuccess`, failure → `transitionFailure`
- `transitionFailure()`: statusCode 过滤 → 冷却期检查 → 429 分支 / 5xx+连续失败分支 — 均有明确处理
- 早期 return 均带 debug 日志，不会静默丢弃

### B2. structuredClone 使用 ✅

**不适用** — 无深拷贝操作。所有状态变更直接修改 `entry.state`（无需要 clone 的场景）。

### B3. SSE 相关规范 ✅

**不适用** — 此模块不涉及 SSE 流处理。

### B4. 禁止 eslint-disable ✅

grep 确认：文件中无任何 `eslint-disable` 注释。

### B5. 代码品味原则

| 原则 | 评估 | 说明 |
|------|------|------|
| 兜底响应 | N/A | 非 HTTP handler |
| 完整错误提取 | N/A | 不解析上游错误响应 |
| 幂等注册 | N/A | 无 register 模式 |
| structuredClone | N/A | 无深拷贝 |
| SSE data 拼接 | N/A | 无 SSE |
| 插件过滤一致性 | N/A | 无插件 |
| headers 安全 | N/A | 不处理 headers |
| Hook 降级 | N/A | 无 Hook |
| 数据消费者完整性 | ⚠️ | 见 SF-1 |
| 前端控件模式 | N/A | 后端代码 |
| Hook 注册验证 | N/A | 无 Hook |

### B6. max-lines 限制 ✅

| 指标 | 限制 | 实际 | 状态 |
|------|------|------|------|
| 文件行数 | 1000 | 208 | PASS |
| 最大函数行数 (`transitionFailure`) | 300 | 47 | PASS |

### B7. 命名常量 ✅

所有数值常量已提取为顶层 `const`：`RATE_LIMIT_STATUS`, `HTTP_SERVER_ERROR_MIN`, `ADAPTIVE_MIN`, `CAPACITY_LOG_BASE`, `CLIMB_*`, `DROP_*`, `COOLDOWN_*`, `AT_MAX_COUNTER_HALVE_DIVISOR`。无魔法数字。

### B8. 类型安全 ✅

- 无 `any` 使用
- 无 `Record<string, unknown>` 裸访问
- 接口定义清晰（`AdaptiveEntry`, `AdaptiveProfile` 内聚）
- `AdaptiveResult` 的可选字段用 `?:` 标注，读取时做了 `?? false` 防护（L175 `retryRuleMatched: result.retryRuleMatched ?? false`）

## SHOULD FIX

### SF-1: `AdaptiveResult.wasQueued` 成为死字段

**严重度：** SHOULD FIX（代码卫生）
**位置：** `types.ts:23` + `orchestrator.ts:161,168`
**问题：** V3 移除了 `limitReached` 状态和 `wasQueued` 利用率门控，但 `AdaptiveResult.wasQueued` 字段保留在类型定义中，`orchestrator.ts` 仍在传递该字段（L161, L168），而 `adaptive-controller.ts` 完全不读取它。
**影响：** 功能无影响（多传字段不报错），但违反 CLAUDE.md「数据消费者完整性」原则 — 残留字段增加理解成本，后续维护者可能误以为有利用率门控逻辑。
**建议：** 在同一 PR 或后续 cleanup PR 中：
1. 移除 `AdaptiveResult.wasQueued` 字段
2. 移除 `orchestrator.ts` 中的 `wasQueued: wasEverQueued` 传参
3. 如果 `wasEverQueued` 变量无其他消费者，一并清理

## NITPICK

### N-1: `AT_MAX_COUNTER_HALVE_DIVISOR` 命名可更直观

**严重度：** NITPICK
**位置：** `adaptive-controller.ts:25`
**说明：** `AT_MAX_COUNTER_HALVE_DIVISOR = 2` 描述了"满额时保留半数"的行为，用"除数"（DIVISOR）表达语义稍显间接。`AT_MAX_SUCCESS_RETAIN_RATIO` 或 `COUNTER_RETAIN_FRACTION` 可能更直观。但当前命名通过 JSDoc 补充说明，可接受。

## 结论

**Verdict: PASS** — 变更完全符合 CLAUDE.md 编码规范。V3 简化彻底移除了 `limitReached`/`keepRatio` 状态，冷却期翻转语义（阻止下降、不阻止上升）设计清晰。0 个 MUST FIX，1 个 SHOULD FIX（死字段清理），1 个 NITPICK。

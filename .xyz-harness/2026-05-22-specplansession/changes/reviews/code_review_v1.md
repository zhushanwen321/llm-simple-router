---
verdict: fail
must_fix: 1
review:
  type: code_review
  round: 1
  timestamp: "2026-05-22T22:30:00"
  target: "fix-usage-limit-return branch core implementation"
  summary: "编码评审完成，第1轮，1条MUST FIX（provider unavailable failover 行为退化），需修改后重审"

statistics:
  total_issues: 7
  must_fix_resolved: 0
  low: 4
  info: 2

issues:
  - id: 1
    severity: MUST_FIX
    location: "router/src/proxy/handler/failover-loop.ts:L323"
    title: "Provider unavailable 从 continue 改为 return，破坏 failover 链"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 2
    severity: LOW
    location: "router/package.json:L2"
    title: "版本号从 0.11.17 降级为 0.11.15"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 3
    severity: LOW
    location: "diff (multiple files)"
    title: "大量无关变更混入本分支（scope creep）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 4
    severity: LOW
    location: "router/src/admin/retry-rules.ts:L300"
    title: "provider_id 未校验是否存在于 providers 表"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 5
    severity: LOW
    location: "router/src/admin/retry-rules.ts:L297-304"
    title: "body_matchers 启用时仍强制校验 body_pattern 正则"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 6
    severity: INFO
    location: "router/src/db/upstream-error-logs.ts"
    title: "cleanUpstreamErrorLogs 已导出但未接入清理机制"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 7
    severity: INFO
    location: "router/src/proxy/orchestration/retry-rules.ts:L28"
    title: "绑定规则排序依赖 getActiveRetryRules 的 created_at DESC，已确认正确"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# 编码评审 v1

## 评审记录
- 评审时间：2026-05-22 22:30
- 评审类型：编码评审
- 评审对象：fix-usage-limit-return 分支核心实现（body-matcher, retry-rules, upstream-error-logs, resilience, failover-loop, admin/retry-rules, RetryRules.vue）

## Spec 合规检查

逐条对照 spec.md 的 FR1-FR9 验收标准：

| FR | 要求 | 实现状态 | 说明 |
|----|------|---------|------|
| FR1 | Provider 隔离（provider_id + 匹配优先级） | ✅ 通过 | retry-rules.ts 二级缓存 `${providerId ?? '__global__'}:${statusCode}`，先查绑定再查通用 |
| FR2 | JSON 字段匹配（equals/contains/exists + AND） | ✅ 通过 | body-matcher.ts 纯函数，三操作符全部实现，AND 逻辑正确，JSON parse 失败 fallback |
| FR3 | RetryRuleMatcher.match() 签名 + 调用方传参 | ✅ 通过 | resilience.ts 三处调用 + transport-fn.ts 一处调用均已传入 providerId |
| FR4 | stream_error 响应路径修复 | ✅ 通过 | failover-loop.ts 新增 stream_error + !headersSent 分支，格式化错误体 + updateLogClientStatus |
| FR5 | upstream_error_logs 表 + 写入 | ✅ 通过 | 迁移 049 建表，logUpstreamError 在 failover-loop 失败路径写入，extractErrorInfo 提取错误信息 |
| FR6 | 前端 RetryRules 页面适配 | ✅ 通过 | Provider 列 + Select + Tab 切换 + JSON 匹配编辑器（增删行 + exists 隐藏值） |
| FR7 | DB Schema 变更（向后兼容） | ✅ 通过 | ALTER TABLE ADD COLUMN NULL DEFAULT NULL，不破坏现有数据 |
| FR8 | Admin API 适配 | ✅ 通过 | Create/Update 接受新字段，validateBodyMatchers 校验格式 |
| FR9 | StateRegistry 刷新 | ✅ 通过 | 已有 `stateRegistry?.refreshRetryRules()` 触发 `load()` 重建缓存 |

**AC 覆盖验证：**

| AC | 场景 | 核心实现覆盖 |
|----|------|-------------|
| AC1 | Provider 隔离（绑定/通用/优先级/多规则排序） | ✅ retry-rules.ts match() 先绑定后通用；getActiveRetryRules ORDER BY created_at DESC |
| AC2 | JSON 字段匹配（equals/contains/exists/fallback/嵌套） | ✅ body-matcher.ts 逐操作符实现 |
| AC3 | 429 usage-limit 不再误触发 | ✅ 绑定规则隔离 + body_matchers 精确匹配 |
| AC4 | stream_error 响应返回客户端 | ✅ failover-loop.ts L519-529 格式化 + updateLogClientStatus |
| AC5 | upstream_error_logs 写入 | ✅ failover-loop.ts L471-491 失败路径写入 |
| AC6 | 前端 Provider 选择 | ✅ RetryRules.vue Select + Badge |
| AC7 | 前端 JSON 匹配编辑 | ✅ Tab 切换 + 增删条件行 + exists 隐藏值 |
| AC8 | 向后兼容 | ✅ 新列 NULL DEFAULT NULL，现有行为不变 |

**结论：所有 spec 功能需求已正确实现。**

### 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | MUST FIX | failover-loop.ts:L323 | Provider unavailable 处理从 `continue` 改为 `return rejectAndReply`，破坏 failover 链 | 恢复为旧逻辑（insertRejectedLog + excludeTargets.push + continue），或将 rejectAndReply 的日志+排除逻辑拆开，保持 continue |
| 2 | LOW | router/package.json:L2 | 版本号从 0.11.17 降为 0.11.15 | 合并前 rebase main 同步版本号 |
| 3 | LOW | diff (多文件) | 无关变更混入：LogTableRow 重构、Dashboard 响应式、RouterKeys 复制按钮、Providers URL 截断、stream-ant2resp/stream-bridge-chat2resp item_id 移除 | 将无关变更拆到独立 PR |
| 4 | LOW | admin/retry-rules.ts:L300 | provider_id 存入 DB 前未校验是否在 providers 表中存在 | 添加 FK 式校验，或确认 UI 限制已足够 |
| 5 | LOW | admin/retry-rules.ts:L297-304 | body_matchers 设为 JSON 模式时，body_pattern 的正则校验仍然执行 | 当 body_matchers 非空时跳过 body_pattern 正则校验（空值已通过，但非空无效正则会阻止保存） |
| 6 | INFO | upstream-error-logs.ts | cleanUpstreamErrorLogs 已导出但未接入现有日志清理机制 | 后续 PR 接入 |
| 7 | INFO | retry-rules.ts:L28 | 绑定规则排序依赖 getActiveRetryRules 的 `created_at DESC`，已确认正确 | 无需操作 |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，但不阻塞
> - **INFO**：观察记录，无需操作

#### MUST FIX 详情

**#1: Provider unavailable 从 continue 改为 return，破坏 failover 链**

**位置**：`router/src/proxy/handler/failover-loop.ts` L323

**旧代码**（已删除）：
```typescript
lastFailoverTrigger = "provider_unavailable";
insertRejectedLog({ db, logId, ... });
excludeTargets.push(resolved);
continue;  // 尝试下一个 target
```

**新代码**：
```typescript
return rejectAndReply(reply, rCtx, errors.providerUnavailable(),
  `Provider '${resolved.provider_id}' unavailable`, resolved.provider_id);
// 立即返回错误，不再尝试下一个 target
```

**为什么是问题**：
- `executeFailoverLoop` 是一个迭代循环，逐个尝试 mapping group 中的多个 target
- 旧逻辑：provider 不可用 → 记录日志 → 排除该 target → `continue` 尝试下一个
- 新逻辑：provider 不可用 → 记录日志 → 发送错误响应 → `return` 退出整个函数
- **影响**：当 mapping group 配置了多个 provider（failover 模式），且某个 provider 不可用时，旧逻辑会尝试下一个 provider，新逻辑直接失败。这使 failover 对 "provider 不可用" 场景失效
- **不在 spec 范围内**：此变更未在 spec.md 中提及，属于副作用改动
- **测试可能未覆盖**：需要 provider 不可用 + 多 target failover 组合场景才能触发

**修改方向**：恢复 `continue` 逻辑。可以保留 `rejectAndReply` 的日志部分，但必须用 `excludeTargets.push(resolved) + continue` 替代 `return`：
```typescript
// 建议恢复为：
insertRejectedLog({ ... });
excludeTargets.push(resolved);
lastFailoverTrigger = "provider_unavailable";
continue;
```
或拆分 `rejectAndReply` 使日志和响应分离，日志后 continue。

## 代码质量

### 可读性
- **body-matcher.ts**：注释充分（"为什么"注释解释设计意图），纯函数无副作用，命名清晰。✅
- **retry-rules.ts（RetryRuleMatcher）**：缓存 key 格式清晰，`findMatch` 私有方法封装良好，双路径（body_matchers → body_pattern）逻辑直观。✅
- **upstream-error-logs.ts**：extractErrorInfo 注释说明了提取优先级（type > code），clean 函数简洁。✅
- **admin/retry-rules.ts**：validateBodyMatchers 校验完整（数组、对象、path/operator/value 类型检查），错误信息具体。✅
- **RetryRules.vue**：FormData 接口定义清晰，DEFAULT_FORM 类型完整，验证逻辑按 matchMode 分支处理。✅

### 错误处理
- `matchBodyMatchers`：JSON.parse 失败返回 false（正确，非 JSON body 不应匹配 JSON 条件）。✅
- `extractErrorInfo`：JSON.parse 失败返回 null（正确）。✅
- `validateBodyMatchers`：对每条 matcher 的 path/operator/value 做类型检查，抛出具体错误信息。✅
- `formatBodyMatch`（前端）：JSON.parse 失败 fallback 显示原始字符串。✅

### 边界条件
- `resolvePath`：null/undefined 中间层正确返回 undefined。不支持数组索引（spec 未要求）。✅
- `RetryRuleMatcher.match`：providerId 为空/falsy 时跳过绑定规则，只查通用。✅
- 前端 body_matchers 序列化：过滤掉无效条件（path 为空或 exists 以外 value 为空）。✅

## 架构合规

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 四层架构分层 | ✅ | body-matcher 在 Orchestration 层（纯函数），RetryRuleMatcher 在 Orchestration 层（缓存），upstream-error-logs 在 DB 层，admin/retry-rules 在 Admin 层 |
| 依赖方向 | ✅ | orchestration → db（单向），admin → db（单向），无跨层违规 |
| buildUpdateQuery 白名单 | ✅ | RETRY_FIELDS Set 已包含 provider_id 和 body_matchers |
| FormatAdapter | ✅ | stream_error 使用 `adapter.formatError()` 格式化 |
| structuredClone vs JSON roundtrip | ✅ | 未引入新的 JSON.parse/stringify 深拷贝 |
| 禁止裸 JSON.parse models | ✅ | retry-rules.ts 中 body_matchers 的 JSON.parse 是合理的（非 models 字段） |

## 安全和性能

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 注入风险 | ✅ | DB 操作使用 prepared statements，buildUpdateQuery 白名单过滤 |
| 输入校验 | ✅ | validateBodyMatchers 校验 path/operator/value 类型和枚举值 |
| 正则 ReDoS | ✅ | body_pattern 编译为 RegExp 时使用原生构造器，admin API 有 try-catch |
| 性能影响 | ✅ | JSON.parse 单次 + 路径查找 vs 原有正则匹配，无 N+1 查询 |
| 缓存重建 | ✅ | load() 清除旧缓存后重建，无竞态（同步操作） |

## 集成验证

### 数据消费者完整性

| 消费者 | provider_id | body_matchers | upstream_error_logs |
|---------|-------------|---------------|--------------------|
| DB 写入 | ✅ createRetryRule / updateRetryRule | ✅ createRetryRule / updateRetryRule | ✅ logUpstreamError |
| 内存缓存 | ✅ RetryRuleMatcher.load 二级缓存 | ✅ JSON.parse 为 BodyMatcher[] | N/A |
| Admin API | ✅ GET/POST/PUT + validateBodyMatchers | ✅ GET/POST/PUT | N/A |
| 前端 | ✅ RetryRules.vue Select + Badge | ✅ Tab 编辑器 + 序列化 | N/A |
| SSE 监控 | N/A（spec 声明 Out of Scope）| N/A | N/A |

### 调用链验证

1. **RetryRuleMatcher.match() 调用路径**：
   - `resilience.ts:decide()` → `config.ruleMatcher.match(statusCode, body, config.providerId)` ✅
   - `resilience.ts:evaluateFailover()` → `config.ruleMatcher.match(result.statusCode, body, config.providerId)` ✅
   - `resilience.ts:evaluateLowSeverity()` → `config.ruleMatcher.match(result.statusCode, body, config.providerId)` ✅
   - `transport-fn.ts` → `p.matcher!.test(UPSTREAM_SUCCESS, data, p.provider.id)` ✅
   - `orchestrator.ts` → 传入 `providerId: config.provider.id` ✅

2. **StateRegistry 刷新链**：
   - `admin/retry-rules.ts` Create/Update/Delete → `stateRegistry?.refreshRetryRules()` ✅
   - → `RetryRuleMatcher.load(db)` → 重建二级缓存 ✅

3. **upstream_error_logs 写入链**：
   - `failover-loop.ts` → resilience 失败 → `extractErrorInfo(body)` → `logUpstreamError(db, {...})` ✅

## 结论

需修改后重审。1 条 MUST FIX：failover-loop.ts 中 provider unavailable 处理从 `continue` 改为 `return`，破坏了 failover 多 target 轮询行为。核心功能（FR1-FR9）实现正确，代码质量良好，架构合规，安全性能无明显问题。

### Summary

编码评审完成，第1轮，1条MUST FIX，需修改后重审。

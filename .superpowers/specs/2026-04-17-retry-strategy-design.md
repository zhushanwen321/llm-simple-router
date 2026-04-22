# Retry Strategy 设计文档

## 概述

在现有 retry_rules 基础上，为每条规则独立配置重试策略（固定间隔 / 指数退避）、延迟参数和最大重试次数。使用策略模式封装延迟计算逻辑。

## 需求

- 每条 retry rule 可选择：固定间隔（fixed）或指数退避（exponential）
- 每条规则可独立配置：初始延迟、最大重试次数、延迟上限（仅 exponential）
- 固定间隔默认 5s，指数退避初始默认 5s，最大重试次数默认 10 次，退避上限默认 60s
- 429 时延迟 = `max(策略计算值, Retry-After header)`
- 保留全局 `RETRY_MAX_ATTEMPTS` / `RETRY_BASE_DELAY_MS` 作为回退
- 多规则匹配时取第一条匹配规则的策略

## DB 变更

Migration 013：`retry_rules` 表新增 4 列：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `retry_strategy` | TEXT NOT NULL DEFAULT 'exponential' CHECK(retry_strategy IN ('fixed','exponential')) | `'exponential'` | `'fixed'` 或 `'exponential'` |
| `retry_delay_ms` | INTEGER NOT NULL DEFAULT 5000 | 5000 | 固定间隔延迟 / 指数退避初始延迟 |
| `max_retries` | INTEGER NOT NULL DEFAULT 10 | 10 | 额外重试次数（不含首次请求） |
| `max_delay_ms` | INTEGER NOT NULL DEFAULT 60000 | 60000 | 指数退避延迟上限 |

已有行通过 `ALTER TABLE ... DEFAULT` 自动填充默认值。

**语义明确**：`max_retries` = 额外重试次数（不含首次请求），与现有 `config.maxRetries` 语义一致。循环 `attempt <= maxRetries`，`maxRetries=10` 意味着最多 11 次请求（1 首次 + 10 重试）。

## 策略模式设计

### 接口

```typescript
interface RetryStrategy {
  getDelay(attempt: number): number;
}
```

### 实现

**FixedIntervalStrategy**：每次返回 `retry_delay_ms`，无视 attempt。

**ExponentialBackoffStrategy**：`min(retry_delay_ms * 2^attempt, max_delay_ms)`。

### 延迟计算

**正常响应（有 statusCode）**：
```typescript
delay = Math.max(strategy.getDelay(attempt), retryAfterMs ?? 0)
```

**网络异常（throw）**：无响应头，直接使用 `strategy.getDelay(attempt)`。当前代码网络异常时用固定 `baseDelayMs`，改造后也应用策略的退避逻辑。

## RetryRuleMatcher 改造

### 缓存结构变更

现有 `Map<number, RegExp[]>` 改为 `Map<number, { rule: RetryRule, pattern: RegExp }[]>`，保留完整规则信息。

### 方法变更

- 保留 `test()` 方法（向后兼容，内部调用 `match()`）
- 新增 `match(statusCode: number, body: string): RetryRule | null` — 返回第一条匹配的完整规则

匹配顺序：按 SQL `ORDER BY created_at DESC`，即最新创建的规则优先。

### 回退行为

无匹配规则时，回退到全局 `RETRY_MAX_ATTEMPTS` / `RETRY_BASE_DELAY_MS`，使用 ExponentialBackoffStrategy（保持当前行为）。全局回退无 cap（`max_delay_ms = Infinity`），因为当前代码无上限。

## 数据流

```
请求到达 → RetryRuleMatcher.match(statusCode, body)
  → 匹配到规则 → 用规则的 max_retries + 构建对应 Strategy → retryableCall
  → 无匹配 → 全局 maxRetries + ExponentialBackoffStrategy(无 cap) → retryableCall
```

## 涉及文件

- `src/db/migrations/013_add_retry_strategy.sql` — 新增 4 列 + CHECK 约束
- `src/db/retry-rules.ts` — RetryRule 类型扩展、seed 默认值更新
- `src/proxy/retry-rules.ts` — 缓存结构重构、新增 match() 方法
- `src/proxy/retry.ts` — RetryStrategy 接口、两个实现、retryableCall 改造（支持 per-rule 策略）
- `src/proxy/proxy-core.ts` — 传递全局配置作为回退参数
- `src/admin/retry-rules.ts` — Create/Update schema 新增字段 + retry_strategy 校验
- `frontend/src/views/RetryRules.vue` — 编辑表单增加策略选择和参数输入

## 向后兼容

- 已有行通过 ALTER TABLE DEFAULT 获得默认值
- `test()` 方法保留，现有调用方不受影响
- 全局环境变量保留，无匹配规则时回退
- API 新增字段均为可选，不破坏现有客户端
- 网络异常场景也应用策略模式（行为变化：从固定延迟变为按策略计算）

## 容错

- `retry_strategy` 字段有 CHECK 约束，非法值无法写入
- 代码层面对策略值做 defensive check，未知策略回退为 exponential

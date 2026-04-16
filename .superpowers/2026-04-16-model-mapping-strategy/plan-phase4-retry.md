# Phase 4: 重试规则匹配器

## 目标

将硬编码的 `isRetryable400Body` 替换为基于数据库规则的 `RetryRuleMatcher`，使重试条件可配置。

## 依赖

- Task 1 的 `retry_rules` 表及 `getActiveRetryRules(db)` 已就绪

## 实施步骤

### Step 1: 创建 RetryRuleMatcher

**新建** `src/proxy/retry-rules.ts`

- 维护 `Map<number, RegExp[]>` 缓存（status_code → 编译后的正则列表）
- `load(db)` 从 DB 加载规则，重建缓存
- `test(statusCode, body)` 判断是否匹配任一规则

### Step 2: 匹配器单元测试

**新建** `tests/retry-rules-matcher.test.ts`

用内存 DB，INSERT 记录后验证：
1. 无规则 → false
2. 状态码不匹配 → false
3. 状态码匹配但正则不匹配 → false
4. 状态码 + 正则都匹配 → true
5. 同状态码多规则，任一命中 → true
6. `load()` 后缓存刷新 → 新规则生效

### Step 3: 改造 retry.ts

- 删除 `isRetryable400Body` 函数
- `RetryConfig` 移除 `isRetryableBody`，新增 `ruleMatcher?: RetryRuleMatcher`
- `isRetryableResult` 逻辑：先检查 `retryableStatuses`，再调用 `ruleMatcher.test(statusCode, body)`
- `buildRetryConfig` 新增 `ruleMatcher` 参数

### Step 4: 运行测试

```bash
npx vitest run tests/retry.test.ts tests/retry-rules-matcher.test.ts tests/retry-integration.test.ts
```

### Step 5: 提交

```
feat: add RetryRuleMatcher for configurable retry conditions
```

## 文件变更清单

| 操作 | 文件 |
|------|------|
| 新增 | `src/proxy/retry-rules.ts` |
| 新增 | `tests/retry-rules-matcher.test.ts` |
| 修改 | `src/proxy/retry.ts` |

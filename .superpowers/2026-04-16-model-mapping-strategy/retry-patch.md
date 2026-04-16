# 重试条件配置化

将硬编码的重试判断逻辑提取为规则化的配置系统，支持状态码 + 响应体正则匹配。

## 现状问题

当前 `isRetryable400Body`（`src/proxy/retry.ts:40`）硬编码了两个 ZAI middleware 错误模式：
- `err.code === "1234"`
- `err.message?.includes("请稍后重试")`

新发现的错误 `{"type":"error","error":{"message":"操作失败","code":"500"}}` 也需要重试。持续硬编码不可维护。

## 新增表 retry_rules

```sql
CREATE TABLE retry_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  body_pattern TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**预置规则**（迁移时自动插入）：

| name | status_code | body_pattern |
|------|-------------|--------------|
| ZAI 网络错误 (code 1234) | 400 | `"type"\s*:\s*"error".*"code"\s*:\s*"1234"` |
| ZAI 临时不可用 | 400 | `"type"\s*:\s*"error".*请稍后重试` |
| ZAI 操作失败 (code 500) | 400 | `"type"\s*:\s*"error".*"code"\s*:\s*"500"` |

## 运行时逻辑

1. 启动时从 DB 加载所有 active 规则，缓存到内存 `Map<statusCode, RegExp[]>`
2. `isRetryableResult` 检查：status_code 命中 `retryableStatuses`（429/503 直接通过）**或**命中某条 retry_rule 的 status_code 且 body 匹配对应正则
3. 规则增删通过 Admin API，更新后刷新内存缓存

## 代码变更

- `src/proxy/retry.ts`：`RetryConfig` 移除 `isRetryableBody` 字段，改为接收 `RetryRuleMatcher`（内存缓存对象）
- `src/db/index.ts`：新增 `getActiveRetryRules()`、CRUD 函数
- `src/index.ts`：启动时加载规则到内存，注入到 proxy 插件

## Admin API

- GET `/admin/api/retry-rules` — 列出规则
- POST `/admin/api/retry-rules` — 添加规则（验证正则语法）
- PUT `/admin/api/retry-rules/:id` — 更新
- DELETE `/admin/api/retry-rules/:id` — 删除
- 变更后触发内存缓存刷新

## 前端

Settings 页面（或独立的 Retry Rules 页面）新增规则管理表格。每行显示 name、status_code、body_pattern、启用状态。添加/编辑 Dialog 含正则验证。

# Task 6-7: 代理层

## Task 6: 代理层白名单校验 + 日志传递

**Files:**
- Modify: `src/proxy/openai.ts`
- Modify: `src/proxy/anthropic.ts`
- Modify: `src/proxy/proxy-core.ts`

### 白名单校验

在 `openai.ts` 和 `anthropic.ts` 的 POST handler 中，`getModelMapping()` 成功后、`getProviderById()` 之前插入校验：

```typescript
// 白名单校验：映射后的 backend_model 必须在 router_key 的允许列表中
const allowedModels = request.routerKey?.allowed_models;
if (allowedModels) {
  try {
    const models: string[] = JSON.parse(allowedModels);
    if (models.length > 0 && !models.includes(mapping.backend_model)) {
      return sendError(reply, openaiError(
        `Model '${mapping.backend_model}' is not allowed for this API key`,
        "invalid_request_error", "model_not_allowed", 403
      ));
    }
  } catch { /* allowed_models 为 null 或无效 JSON，放行 */ }
}
```

### 日志传递

`insertRequestLog` 所有调用点（openai.ts 和 anthropic.ts 中）增加 `router_key_id: request.routerKey?.id ?? null`。

涉及所有 `insertRequestLog` 和 `insertSuccessLog` 调用：
- openai.ts: retry attempt 日志（attempt.error / attempt.statusCode / success）、catch 块日志
- anthropic.ts: retry attempt 日志（attempt.error / attempt.statusCode / success）、catch 块日志

### insertSuccessLog 修改

在 `proxy-core.ts` 的 `insertSuccessLog` 函数签名中增加 `router_key_id` 参数，传递给 `insertRequestLog`。

- [ ] **Step 1: 修改 `proxy-core.ts` 的 `insertSuccessLog`，增加 `router_key_id` 参数**

- [ ] **Step 2: 修改 `openai.ts`：白名单校验 + 所有 insertRequestLog/insertSuccessLog 调用传入 router_key_id**

- [ ] **Step 3: 修改 `anthropic.ts`：白名单校验 + 所有 insertRequestLog/insertSuccessLog 调用传入 router_key_id**

- [ ] **Step 4: 运行全部代理相关测试**

Run: `npx vitest run tests/openai-proxy.test.ts tests/anthropic-proxy.test.ts`
Expected: 现有测试需适配（注入 router_key 到内存 DB），全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/proxy/openai.ts src/proxy/anthropic.ts src/proxy/proxy-core.ts
git commit -m "feat: add model whitelist check and router_key_id logging in proxy layer"
```

---

## Task 7: 适配代理测试

**Files:**
- Modify: `tests/openai-proxy.test.ts`
- Modify: `tests/anthropic-proxy.test.ts`
- Modify: `tests/integration.test.ts`
- Modify: `tests/retry-integration.test.ts`
- Modify: `tests/admin-providers.test.ts`
- Modify: `tests/admin-mappings.test.ts`
- Modify: `tests/admin-logs.test.ts`
- Modify: `tests/logging.test.ts`
- Modify: `tests/db.test.ts`（如用到 buildApp）
- Modify: `tests/models-proxy.test.ts`

- [ ] **Step 1: 在所有使用 `buildApp({ db })` 的测试中，向内存 DB 预插入一条测试 router_key**

提取公共 helper：
```typescript
export function setupTestRouterKey(db: Database.Database) {
  const hash = createHash("sha256").update("test-key").digest("hex");
  db.prepare(
    "INSERT INTO router_keys (id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?)"
  ).run("test-router-key-id", "Test", hash, "test-key");
}
```

所有测试的 `beforeEach` 中调用此函数。测试请求的 Authorization header 使用 `Bearer test-key`。

- [ ] **Step 2: 运行全部测试**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add tests/
git commit -m "test: adapt proxy tests for router_keys auth"
```

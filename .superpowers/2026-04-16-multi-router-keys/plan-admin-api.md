# Task 8-9: Admin API

## Task 8: Router Keys Admin CRUD

**Files:**
- Create: `src/admin/router-keys.ts`
- Modify: `src/admin/routes.ts`

- [ ] **Step 1: 创建 `src/admin/router-keys.ts`**

参照 `providers.ts` 的模式，实现：
- `GET /admin/api/router-keys` — 列表（返回 id, name, key_prefix, allowed_models, is_active, created_at, updated_at；不含 key_hash）
- `POST /admin/api/router-keys` — 创建。生成随机 key（`sk-router-` + 32 字节 hex），计算 hash 和 prefix，存入 DB。响应中返回明文 key（仅此一次）
- `PUT /admin/api/router-keys/:id` — 更新 name, allowed_models, is_active
- `DELETE /admin/api/router-keys/:id` — 删除（关联日志保留）
- `GET /admin/api/models/available` — 返回 `string[]`，SQL: `SELECT DISTINCT backend_model FROM model_mappings ORDER BY backend_model`

创建 key 的核心逻辑：
```typescript
import { randomBytes, createHash } from "crypto";

function generateRouterKey(): { key: string; hash: string; prefix: string } {
  const key = `sk-router-${randomBytes(32).toString("hex")}`;
  const hash = createHash("sha256").update(key).digest("hex");
  const prefix = key.slice(0, 8);
  return { key, hash, prefix };
}
```

- [ ] **Step 2: 在 `src/admin/routes.ts` 中注册新路由**

```typescript
import { adminRouterKeyRoutes } from "./router-keys.js";
// ...
app.register(adminRouterKeyRoutes, { db: options.db });
```

- [ ] **Step 3: Commit**

```bash
git add src/admin/router-keys.ts src/admin/routes.ts
git commit -m "feat: add router keys admin CRUD API"
```

---

## Task 9: 扩展现有 API 筛选

**Files:**
- Modify: `src/db/metrics.ts`
- Modify: `src/admin/logs.ts`
- Modify: `src/admin/stats.ts`
- Modify: `src/admin/metrics.ts`

- [ ] **Step 1: `src/db/metrics.ts` — getMetricsSummary 和 getMetricsTimeseries 新增 routerKeyId 参数**

两个函数签名增加 `routerKeyId?: string`。在 SQL 中 JOIN request_logs（LEFT JOIN，因为 metrics 总有对应 log，但保持安全）：
```sql
FROM request_metrics rm
LEFT JOIN providers p ON p.id = rm.provider_id
LEFT JOIN request_logs rl ON rl.id = rm.request_log_id
```
当 routerKeyId 存在时增加 `AND rl.router_key_id = ?`。

- [ ] **Step 2: `src/admin/logs.ts` — LogQueryParams 增加 `router_key_id`，传递给 getRequestLogs**

- [ ] **Step 3: `src/admin/stats.ts` — getStats 增加 router_key_id 筛选（需要修改 `src/db/index.ts` 中的 `getStats` 函数签名和 SQL）**

- [ ] **Step 4: `src/admin/metrics.ts` — query 类型增加 `router_key_id`，传递给 getMetricsSummary/getMetricsTimeseries**

- [ ] **Step 5: Commit**

```bash
git add src/db/metrics.ts src/admin/logs.ts src/admin/stats.ts src/admin/metrics.ts src/db/index.ts
git commit -m "feat: extend logs/stats/metrics APIs with router_key_id filter"
```

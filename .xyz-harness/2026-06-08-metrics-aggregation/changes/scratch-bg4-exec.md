# BG4 执行记录：活动图数据端点

## 修改文件清单

| 文件 | 改动 |
|------|------|
| `router/src/admin/metrics.ts` | 新增 `GET /admin/api/metrics/activity` 端点 + `ActivityQuerySchema` |

## 改动详情

### metrics.ts

**新增 import：**
```typescript
import { queryAggActivity } from "../db/metrics-10min.js";
```

**新增 query schema：**
```typescript
const ActivityQuerySchema = Type.Object({
  router_key_id: Type.Optional(Type.String()),
  provider_id: Type.Optional(Type.String()),
});
```

**新增端点（注册在 timeseries 之后、done() 之前）：**
```typescript
app.get("/admin/api/metrics/activity", { schema: { querystring: ActivityQuerySchema } }, async (request, reply) => {
  const query = request.query as Static<typeof ActivityQuerySchema>;
  const buckets = queryAggActivity(db, {
    routerKeyId: query.router_key_id,
    providerId: query.provider_id,
  });
  return reply.send({ buckets });
});
```

## 与任务描述的差异说明

任务描述中 `queryAggActivity` 的调用形式为 `queryAggActivity(db, router_key_id, provider_id)`（分立参数），
实际函数签名为 `queryAggActivity(db, filters?: { routerKeyId?: string; providerId?: string })`（filters 对象），
实现以实际签名为准，**未变更 DB 层函数签名**（符合"禁止擅自变更接口签名"约束）。

## 设计决策

1. **沿用 TypeBox schema + Static<>**：与同文件 summary/timeseries 端点保持一致，避免 `Record<string, unknown>` 直接断言。
2. **filters 对象而非分立参数**：与 `queryAggActivity` 实际签名匹配，调用方传 undefined 字段会被函数内部忽略。
3. **响应包装 `{ buckets }`**：与任务规格一致；DB 层返回数组元素形如 `{ bucket_time: string, request_count: number }`。

## 验收

- [x] 端点 `GET /admin/api/metrics/activity` 注册成功
- [x] 返回 `{ buckets: [...] }` 格式（bucket 元素 `{ bucket_time, request_count }`）
- [x] 支持 `router_key_id` 和 `provider_id` 可选过滤
- [x] `npx tsc --noEmit` 通过（零错误）
- [x] 无 TODO / FIXME / placeholder
- [x] 无 `as unknown as X` 等 unsafe cast
- [x] 未变更任何已有函数签名

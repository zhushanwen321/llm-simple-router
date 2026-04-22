# 认证与请求流程

## Auth Middleware 改造

当前：timingSafeEqual(token, 环境变量 ROUTER_API_KEY)

改为：
1. 取 Bearer token，计算 SHA-256 hash
2. 用 prepared statement 查 router_keys 表（key_hash = hash AND is_active = 1）
3. 匹配成功：挂载 `request.routerKey = { id, name, allowed_models }`
4. 匹配失败：返回 401

安全说明：改为 hash 比较后不再需要 timingSafeEqual，因为 hash 值本身不是秘密（数据库查询是主要比较手段）。

Prepared statement 在插件初始化阶段创建并缓存，不在每次请求时重新编译。

配置注入从 `{ apiKey }` 改为 `{ db }`。

## Fastify 类型扩展

```typescript
declare module 'fastify' {
  interface FastifyRequest {
    routerKey?: { id: string; name: string; allowed_models: string[] | null };
  }
}
```

## 模型白名单校验

精确插入点：`getModelMapping()` 成功获取 backend_model 之后、`getProviderById()` 之前。

校验逻辑：
1. 解析 `request.routerKey.allowed_models`（JSON.parse）
2. 如果非空数组且 backend_model 不在其中 → 返回 403 + 错误信息
3. 空/null → 放行

`/v1/models` 端点不做白名单校验（仅返回已配置的模型列表）。

## 日志记录

insertRequestLog 新增 router_key_id 参数。代理函数中通过 `request.routerKey?.id` 获取值。所有 insertRequestLog 调用点（成功、失败、重试各 attempt、catch 块）都需要传入此参数。

# Phase 5: Admin API（groups + retry-rules）

## 依赖

- Phase 1（DB 表和函数）必须先完成
- Phase 4（RetryRuleMatcher 类）必须先完成

## Step 1: 新建 src/admin/groups.ts

参照 `admin/mappings.ts` 的 `FastifyPluginCallback` 模式。

**CRUD 路由**（前缀 `/admin/api/mapping-groups`）：
- `GET /` — 调 `getAllMappingGroups(db)`
- `POST /` — 校验 rule JSON + provider 存在性，调 `createMappingGroup`
- `PUT /:id` — 校验后调 `updateMappingGroup`
- `DELETE /:id` — 调 `deleteMappingGroup`

**rule 校验函数** `validateRule(db, strategy, ruleJson)`：
- 解析 JSON，失败返回 400
- `strategy === "scheduled"` 时校验：`rule.default.backend_model` 和 `rule.default.provider_id` 必须存在；`rule.windows` 必须是数组，每个 window 需 `start/end/target.backend_model/target.provider_id`
- 所有 `provider_id` 调 `getProviderById` 确认存在
- 其他 strategy 暂不校验，直接通过

**Option 接口**：`{ db: Database.Database }`

## Step 2: 新建 src/admin/retry-rules.ts

**CRUD 路由**（前缀 `/admin/api/retry-rules`）：
- `GET /` — 调 `getAllRetryRules(db)`
- `POST /` — `new RegExp(body_pattern)` 包裹 try-catch 验证正则合法性，调 `createRetryRule`
- `PUT /:id` — 同样验证正则，调 `updateRetryRule`
- `DELETE /:id` — 调 `deleteRetryRule`

**写操作后刷新缓存**：Option 包含 `matcher: RetryRuleMatcher | null`。POST/PUT/DELETE 成功后，若 matcher 存在则调 `matcher.load(db)` 刷新内存缓存。

**Option 接口**：`{ db: Database.Database; matcher: RetryRuleMatcher | null }`

## Step 3: 改造 mappings.ts 为兼容层

保留原路由路径 `/admin/api/mappings` 不变，内部映射到 group 操作。

**注意**：迁移时 mapping_groups 的 ID 是新生成的（randomblob），与旧 model_mappings 的 ID 不同。旧 API 的 PUT/DELETE 需要通过 client_model 查找 group（而非直接用旧 ID）：

- **GET** — `getAllMappingGroups(db)` → map 为旧格式：`{ id, client_model, backend_model: rule.default.backend_model, provider_id: rule.default.provider_id, is_active: 1 }`
- **POST** — 收 `{ client_model, backend_model, provider_id }` → 创建 group，strategy=`"scheduled"`，rule=`{ default: { backend_model, provider_id }, windows: [] }`
- **PUT /:id** — 先用 id 在 mapping_groups 查找（新 ID），若找不到再用 client_model 查找（兼容过渡期），更新 rule.default
- **DELETE /:id** — 同上查找逻辑，调 `deleteMappingGroup`

## Step 3.5: provider 删除联动

修改 `src/admin/providers.ts` 的 DELETE handler，在删除前扫描所有 mapping_groups 的 rule JSON：

```typescript
const groups = getAllMappingGroups(db);
for (const g of groups) {
  if (g.rule.includes(providerId)) {
    return reply.code(409).send({ error: `Provider is referenced by mapping group '${g.client_model}'` });
  }
}
```

用 `rule.includes(providerId)` 做粗筛（JSON 字符串中包含 provider ID），命中后再做精确 JSON 解析验证。

## Step 4: 注册路由

**修改 src/admin/routes.ts**：
- import `adminGroupRoutes` 和 `adminRetryRuleRoutes`
- 新增 Option 字段 `matcher: RetryRuleMatcher | null`
- `app.register(adminGroupRoutes, { db })`
- `app.register(adminRetryRuleRoutes, { db, matcher })`

**修改 src/index.ts 的 buildApp**：
- import `RetryRuleMatcher`
- buildApp 内创建 `const matcher = new RetryRuleMatcher()` 并在启动时 `matcher.load(db)`
- 将 `matcher` 传入 `adminRoutes` option 和 proxy 插件 option
- proxy 插件的 retry 逻辑改为从 matcher 获取规则，不再从 config 读固定参数

## Step 5: 测试

**tests/admin-groups.test.ts**（参照 admin-mappings.test.ts 结构）：
- 创建 provider → 创建 group（scheduled strategy + rule）→ 列出 → 更新 rule → 删除
- 负面用例：非法 JSON、缺少 default 字段、provider 不存在
- 未认证访问返回 401

**tests/admin-retry-rules.test.ts**（同结构）：
- CRUD 全流程
- 非法正则返回 400
- matcher 刷新验证（创建规则后调 matcher.match() 能匹配到）

## Step 6: 验证 & 提交

```bash
npm test
git add src/admin/groups.ts src/admin/retry-rules.ts \
        src/admin/mappings.ts src/admin/routes.ts src/index.ts \
        tests/admin-groups.test.ts tests/admin-retry-rules.test.ts
git commit -m "feat: add mapping groups and retry rules admin API with backward compat"
```

## 文件变更清单

| 文件 | 操作 |
|------|------|
| `src/admin/groups.ts` | 新建 |
| `src/admin/retry-rules.ts` | 新建 |
| `src/admin/mappings.ts` | 改造为兼容层 |
| `src/admin/routes.ts` | 注册新路由 |
| `src/index.ts` | 创建 matcher、传递给各插件 |
| `tests/admin-groups.test.ts` | 新建 |
| `tests/admin-retry-rules.test.ts` | 新建 |

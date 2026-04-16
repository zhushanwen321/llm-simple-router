# Admin API

## mapping_groups CRUD

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/admin/api/mapping-groups` | 列出所有分组 |
| POST | `/admin/api/mapping-groups` | 创建（body: client_model, strategy, rule） |
| PUT | `/admin/api/mapping-groups/:id` | 更新 |
| DELETE | `/admin/api/mapping-groups/:id` | 删除 |

## rule 验证（创建/更新时）

1. 按 strategy 校验 rule 结构：`scheduled` 必须含 `default`，`windows` 元素必须有 `start`/`end`/`target`
2. rule 中所有 provider_id 必须在 providers 表中存在且 `is_active`
3. client_model 不得与其他 group 重复

## provider 删除联动

删除 provider 前扫描所有 group 的 rule JSON，若被引用则拒绝删除并返回错误。

## 旧 API 兼容

GET/POST/PUT/DELETE `/admin/api/mappings` 标记废弃但保留，转换逻辑：

- **GET**：查 mapping_groups，返回时将 rule.default 展开为 `{ client_model, backend_model, provider_id, is_active }` 格式（兼容旧前端）
- **POST**：创建 mapping_group，strategy='scheduled'，rule=`{ default: { backend_model, provider_id }, windows: [] }`
- **PUT**：更新 group 的 rule.default
- **DELETE**：删除对应 group

迁移过渡期后移除旧 API。

## retry_rules CRUD

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/admin/api/retry-rules` | 列出所有规则 |
| POST | `/admin/api/retry-rules` | 添加（验证正则语法有效） |
| PUT | `/admin/api/retry-rules/:id` | 更新 |
| DELETE | `/admin/api/retry-rules/:id` | 删除 |

创建/更新时验证 body_pattern 是合法的正则表达式。变更后触发内存缓存刷新。

## 文件组织

新增 `src/admin/groups.ts`（mapping_groups 路由）、`src/admin/retry-rules.ts`（retry_rules 路由），`src/admin/mappings.ts` 改为内部调用 groups 逻辑。

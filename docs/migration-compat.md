# Migration Backward Compatibility Log

本文档记录所有"迁移后老版本代码仍可正常运行"的数据库变更。版本稳定后可清理对应迁移和旧列。

## 051: provider_endpoints (2026-05-29)

**关联 ADR**: `docs/adr/0006-provider-multi-api-type-endpoints.md`

| 操作 | 类型 | 影响 |
|------|------|------|
| `ALTER TABLE providers ADD COLUMN endpoints TEXT DEFAULT NULL` | 新增列 | 旧代码不读此列，无影响 |
| `UPDATE providers SET endpoints = json(...)  WHERE endpoints IS NULL` | 填充新列 | 旧列 api_type/base_url/api_key/upstream_path 数据原样保留 |

**回退兼容性**: 老代码读 api_type/base_url/api_key/upstream_path，这些列完整保留。新增的 endpoints 列被忽略。

**旧列清理条件**: 当所有代码路径都使用 parseEndpoints() / resolveEndpoint() 且不再直接读 api_type/base_url/api_key/upstream_path 时，可移除旧列。

**涉及旧列**:
- `providers.api_type` — 被 `parseEndpoints()` 返回的 `ProviderEndpoint.api_type` 替代
- `providers.base_url` — 被 `ProviderEndpoint.base_url` 替代
- `providers.upstream_path` — 被 `ProviderEndpoint.upstream_path` 替代
- `providers.api_key` — 被 `ProviderEndpoint.api_key` 替代（共享 key 语义不变）

## 052: add_upstream_log_fields (2026-05-29)

| 操作 | 类型 | 影响 |
|------|------|------|
| `ALTER TABLE request_logs ADD COLUMN upstream_api_type TEXT DEFAULT NULL` | 新增列 | 旧代码不写此列，值为 NULL |
| `ALTER TABLE request_logs ADD COLUMN upstream_base_url TEXT DEFAULT NULL` | 新增列 | 同上 |

**回退兼容性**: 老代码写入 request_logs 时不包含这两列，SQLite 对未列出的列自动填 DEFAULT NULL。新代码读取时这两列可为 NULL。

**旧列清理条件**: 此迁移只新增列，无旧列可清理。upstream_api_type/upstream_base_url 是新功能字段，不需要清理。

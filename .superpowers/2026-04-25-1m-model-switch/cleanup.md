# 清理清单

## 删除的文件

- `frontend/src/components/proxy-enhancement/ContextCompact.vue`
- `src/proxy/compact.ts`（逻辑迁移到溢出重定向）

## 修改的文件

| 文件 | 变化 |
|------|------|
| `src/proxy/proxy-handler.ts` | 导入改为 `applyOverflowRedirect` |
| `src/proxy/enhancement-config.ts` | 移除 compact 相关字段 |
| `src/admin/proxy-enhancement.ts` | 移除 compact-models 端点、compact schema 字段 |
| `frontend/src/api/client.ts` | 移除 `CompactModelEntry`、`ProxyEnhancementConfig` 中 compact 字段 |
| `frontend/src/views/ProxyEnhancement.vue` | 移除 "1M 上下文压缩" tab |
| `frontend/src/types/mapping.ts` | Target 类型扩展 overflow 字段 |

## 配置迁移

`settings` 表中 `proxy_enhancement` 的 compact 字段（`context_compact_enabled`、`compact_provider_id`、`compact_model`、`custom_prompt_enabled`、`custom_prompt`）在代码中忽略，不需要 DB 迁移。

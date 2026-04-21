# Admin API

## 新增 Router Keys CRUD

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /admin/api/router-keys | 列表（不含 hash） |
| POST | /admin/api/router-keys | 创建，返回明文 key（仅此一次） |
| PUT | /admin/api/router-keys/:id | 更新 name/allowed_models/is_active |
| DELETE | /admin/api/router-keys/:id | 删除 |

创建请求体：`{ name: string, allowed_models?: string[] | null }`
创建响应体：`{ id, name, key: "sk-router-xxx", key_prefix, allowed_models, is_active, created_at }`

## 现有 API 筛选扩展

以下接口新增 `?router_key_id=` 查询参数：
- GET /admin/api/logs
- GET /admin/api/stats
- GET /admin/api/metrics/summary
- GET /admin/api/metrics/timeseries

## 辅助接口

新增 `GET /admin/api/models/available`（Admin 认证保护），返回 `string[]`，内容为 model_mappings 中去重的 backend_model 列表，供前端白名单多选。限制：只能为已配置映射的模型做白名单。

## 删除行为

删除 router key 时，关联的 request_logs 记录保留（router_key_id 保持原值）。Admin API 返回提示"已关联的日志将保留"。

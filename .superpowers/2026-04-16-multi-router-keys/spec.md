# 多 Router Keys 设计

为不同使用方提供独立的 Router API Key，支持按 key 筛选日志和指标，并为每个 key 配置可用模型白名单。

## 需求摘要

1. Admin 后台管理多个 Router Key（增删改查）
2. 每个 Key 可配置允许的 backend_model 白名单（JSON 数组，空 = 全部允许）
3. 前端选择白名单时从已有模型映射中选取
4. 请求日志和指标按 router_key_id 记录，Admin 全局可见可筛选
5. 移除 ROUTER_API_KEY 环境变量，纯数据库管理

## 子文档

- [数据模型](data-model.md) — router_keys 表、request_logs 扩展、key 存储策略
- [认证与请求流程](auth-and-request-flow.md) — auth middleware 改造、白名单校验、日志记录
- [Admin API](admin-api.md) — Router Keys CRUD、现有 API 筛选扩展
- [前端](frontend.md) — API Keys 管理页面、日志/指标筛选栏扩展
- [迁移与兼容](migration.md) — 数据库迁移、环境变量处理、测试影响

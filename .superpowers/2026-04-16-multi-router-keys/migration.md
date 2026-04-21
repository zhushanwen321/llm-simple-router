# 迁移与兼容

## 数据库迁移

新增 `008_create_router_keys.sql`（better-sqlite3 的 db.exec() 在隐式事务中执行）：
- CREATE TABLE router_keys（含索引）
- ALTER TABLE request_logs ADD COLUMN router_key_id
- CREATE INDEX idx_request_logs_router_key

## 环境变量处理

- config.ts 中 ROUTER_API_KEY 从必需变为可选，同步更新 `.env.example`
- 首次启动时：若 router_keys 表为空且环境变量 ROUTER_API_KEY 存在，自动插入 name="Default" 的记录（key_hash = SHA256(ROUTER_API_KEY)）
- 此后完全由数据库管理

## 边界情况

- 已部署实例升级：历史日志 router_key_id 为 NULL，前端筛选时展示为"升级前"或"无 Key"
- 零 Key 状态：若数据库无任何 router_key，代理请求全部 401。Admin 后台 Dashboard 应提示"请先创建 API Key"
- 新部署（无 ROUTER_API_KEY 环境变量）：启动不报错，但 Admin 后台需引导创建第一个 key

## 测试影响

- auth 测试：内存 DB 需预插入 router_key 记录
- 新增 router_keys CRUD 集成测试
- 现有测试通过 buildApp({ db }) 注入不受影响，但需调整 config 注入（移除 ROUTER_API_KEY 必需校验）

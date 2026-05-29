---
verdict: pass
---

# Non-Function Design — Provider Multi-API-Type

## 1. 稳定性
DB 迁移是唯一可能影响稳定性的操作。迁移脚本使用 `WHERE endpoints IS NULL` 条件保护，确保幂等。迁移后旧字段保留不删除，运行时只读新字段。如果迁移失败，服务启动报错而非静默运行，避免数据不一致。resolveEndpoint() 封装层隔离了存储格式变更，下游消费者（patch/plugin/transport）无需感知。

## 2. 数据一致性
endpoints 字段作为 JSON TEXT 存储，与 providers 表的 models 字段采用相同模式（项目已验证可行）。Admin API 的 Create/Update 使用事务确保 endpoints 和旧字段的同步双写。endpoint api_key 的加密方式与 provider 级 api_key 完全一致（AES-256-GCM），避免两套加密逻辑。

## 3. 性能
endpoints 数组长度上限为 3（三种 api_type），JSON.parse 性能可忽略。resolveEndpoint() 在每次请求时调用，但只做数组遍历（O(n), n ≤ 3），无需缓存。前端 endpoint 列表渲染最多 3 项，无虚拟滚动需求。

## 4. 业务安全
不适用。此功能不涉及 Skill 文件或 AI 行为指令。

## 5. 数据安全
endpoint 级 api_key 使用与 provider 级相同的 AES-256-GCM 加密。Admin API GET 返回时解密，日志中不记录 api_key 明文。前端展示使用 maskKey() 函数（前 4 后 4）。request_logs 新增的 upstream_base_url 不含敏感信息（非 key），无需额外脱敏。

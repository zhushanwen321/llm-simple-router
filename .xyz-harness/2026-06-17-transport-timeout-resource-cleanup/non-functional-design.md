---
verdict: pass
---

# 非功能性设计 — Transport 超时与资源泄漏修复

## 1. 稳定性

改动触及代理核心路径（transport/orchestration/semaphore），风险集中于信号传递链路和槽位释放幂等性。缓解：每个 FR 有对应集成测试（mock 上游 + buildApp），重点验证 kill/断连/超时/竞态下的槽位准确回收（AC-1,3,8,13）。`retry headersSent` 等高风险场景明确列为 out-of-scope，避免本次引入不确定变更。signal/timeout 改动均向后兼容（opts 可选参数，不传时行为不变）。

## 2. 数据一致性

`non_stream_timeout_ms` 存储于 `providers.models` JSON 字段（与 stream_timeout_ms 同构），无 SQL 迁移、无 schema breaking。前后端各自用 `parseModels()` 类型安全解析，禁止裸 JSON.parse（ESLint 强制）。存量数据：未配置 non_stream_timeout_ms 的 provider，后端 `getModelTimeouts` 返回默认值 600000，行为等价于"启用默认超时"，向后兼容。`stream_timeout_ms` 默认值后端 600s→300s 收紧，影响未显式配置的存量模型，但 5min 无活动本身属异常（官方上游均发 keepalive），风险可控。

## 3. 性能

无文件扫描/YAML 解析影响。signal 监听（addEventListener once）和 setTimeout 的开销可忽略，不改变请求热路径性能。`abortAllInflight` 仅在 shutdown 时遍历 Map，O(n) 一次性。adaptive 过滤客户端断连减少误退避，反而提升 provider 并发利用率。

## 4. 业务安全

本需求不涉及 AI 行为指令文件（skill/CLAUDE.md），无 prompt 注入面。transport signal/timeout 属基础设施，不影响请求体内容透传。kill 接口已有 JWT 鉴权（admin-auth），无新增权限面。

## 5. 数据安全

无新增敏感信息处理。kill 日志已脱敏 headers（现有 proxy-logging）。release 回调仅传 request id + providerId，不含密钥。DEFAULT_GET_TIMEOUT_MS 防止连通性探测长期挂起占用连接。

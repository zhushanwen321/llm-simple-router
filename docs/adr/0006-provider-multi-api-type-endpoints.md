# ADR 0006: Provider Multi-API-Type Endpoints

## Context

Provider 实体原绑定单一 `{api_type, base_url, api_key}` 组合。同一供应商支持多协议时需创建多个 Provider，且协议不匹配时触发有损格式转换。

## Decision

在 Provider 内新增 `endpoints` JSON 数组字段，每个元素代表一个协议端点 `{api_type, base_url, upstream_path, api_key}`。运行时通过 `resolveEndpoint(provider, clientApiType)` 统一解析，优先精确匹配，无匹配时降级走 FormatRegistry 格式转换。

不采用新建 `provider_endpoints` 关系表，因为 Provider 数量级小（< 50），JSON 字段性能足够且与项目已有模式一致（`models`、`rule` 等均为 JSON TEXT）。

## Consequences

- 一个 Provider 实体可服务多种 API 协议的客户端
- 旧字段 `api_type`/`base_url`/`api_key`/`upstream_path` 通过一次性 DB 迁移转换为 `endpoints` 数组
- 下游消费者统一通过 `ResolvedEndpoint` 获取连接信息，不感知 endpoints 存储细节

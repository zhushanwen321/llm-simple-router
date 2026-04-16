# 模型映射策略：定时切换

将 client_model 从 1:1 映射改造为 1:N，支持多种负载分发策略。第一版仅实现定时切换（scheduled），架构预留轮询/随机/故障转移的扩展能力。

## 需求摘要

1. 一个 client_model 可映射到多个后端模型（跨 Provider）
2. 定时切换：按固定时间窗口（HH:MM）选择不同后端模型，支持多窗口 + 默认兜底
3. 映射解析层统一（openai / anthropic 代理共用同一个 `resolveMapping`）
4. 现有 1:1 映射数据自动迁移
5. 重试条件配置化：将硬编码的重试判断提取为 DB 规则（状态码 + 响应体正则），Admin UI 可管理

## 子文档

- [数据模型与迁移](data-model.md) — mapping_groups 表、rule JSON 结构、retry_rules 表、迁移策略
- [映射解析层](resolver.md) — resolveMapping 统一入口、策略接口、scheduled 实现
- [Admin API](admin-api.md) — mapping_groups CRUD、retry_rules CRUD、JSON rule 验证
- [前端](frontend.md) — 分组配置 UI、时间窗口编辑、重试规则管理
- [重试条件配置化](retry-patch.md) — retry_rules 表设计、正则匹配、内存缓存、Admin CRUD

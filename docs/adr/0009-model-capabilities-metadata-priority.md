# ADR 0009: 模型能力元数据四层优先级合并

模型能力（capabilities，如 text/image/audio/video）有多个数据来源：用户手动配置、内置白名单、外部模型目录。不同来源数据质量不同（白名单经过人工验证，外部目录可能有错误），需要确定合并优先级。

选定方案：四层优先级从高到低——用户手动配置 > 内置白名单 > 外部模型目录 > 默认 `["text"]`。白名单优先于外部目录因为经过人工验证。运行时补充不改 DB 原始 JSON。

## 优先级层级

| 优先级 | 来源 | 存储位置 | 说明 |
|--------|------|----------|------|
| L1（最高） | 用户手动配置 | DB `providers.models` JSON 的 `capabilities` 字段 | Provider 编辑页面可修改 |
| L2 | 内置白名单 | `model-context.ts` 的 `MODEL_CAPABILITIES` | 硬编码，人工验证，发版更新 |
| L3 | 外部模型目录 | `config/model-directory.json` | 由 sync-model-directory.sh 拉取 |
| L4（最低） | 默认值 | — | 不在白名单和目录中的模型默认 `["text"]` |

白名单优先于目录数据：如月之暗面 moonshot-v1 系列 API 支持图片但目录中标记为纯文本，白名单经人工验证更可靠。

## 运行时补充

`parseModels()` 解析时查表填充 capabilities，不修改 DB 原始 JSON。DB 中 capabilities 为空或缺失时由运行时自动补全，避免迁移脚本。

## Considered Options

1. **完全依赖外部 API 查询（runtime fetch）**：增加延迟和外部依赖，离线不可用。
2. **DB 迁移一次性填充**：需要迁移脚本，且新模型上线时需要重新迁移。
3. **只用白名单不用外部目录**：维护成本高，白名单更新依赖发版。
4. **选定方案**：四层优先级合并 + 运行时补充。

## Consequences

- parseModels() 成为能力数据的唯一出口，所有消费方必须通过它获取 capabilities。
- 白名单需要持续维护，新模型上线时需同步更新 model-context.ts。
- 外部目录目前未集成（预留了 L3 层），当前实际只有 L1/L2/L4 三层生效。
- 默认 `["text"]` 意味着未知模型永远不会触发模态重定向，这是安全的保守策略。

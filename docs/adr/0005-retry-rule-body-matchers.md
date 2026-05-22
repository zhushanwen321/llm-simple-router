# 0005-retry-rule-body-matchers

## Context

Retry Rule 的响应体匹配原先只支持正则表达式（`body_pattern`）。正则匹配无法限定到特定 JSON 字段，导致跨 Provider 误命中：一条为 DeepSeek 设计的 `"error".*"type"\s*:\s*"rate_limit_error"` 规则错误匹配了 Kimi 的 usage-limit 响应。

## Decision

新增 `body_matchers` JSON 数组列，支持结构化 JSON 字段匹配（路径 + 操作符 + 值）。保留 `body_pattern` 正则作为 fallback。

选择 JSON 数组而非 JSON Schema 或 JSONPath 的理由：JSON Schema 过于复杂（学习成本高、匹配语义不符），JSONPath 需要额外依赖。JSON 数组格式简单直观，3 个操作符（equals/contains/exists）覆盖常见场景，AND 组合满足当前需求。

## Consequences

- Body Matcher 格式固定，后续新增操作符需要 migration + 代码变更
- 正则匹配保留为 fallback，避免破坏现有规则
- 两套匹配机制并存增加 Matcher 代码复杂度，但逻辑清晰（优先 JSON，fallback 正则）

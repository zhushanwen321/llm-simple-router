# ADR 0014: Transform 浅层格式适配器不重构

proxy/format/ 下有 10 个 converter 文件（如 openai-to-anthropic.ts），每个 12-38 行，都是单次 `createConverter()` 调用 + re-export。架构审查建议合并这些浅层模块。

## Considered Options

1. **合并为 1-2 个 barrel 文件**：所有 converter 注册集中到 index.ts。
2. **保持现状**：每个文件对应一个命名的格式转换路径。

## Decision

**选方案 2：保持现状。**

## Rationale

Deletion test 验证：删除任何一个 converter 文件，把 `createConverter()` 调用移到 index.ts，复杂度不会扩散到 N 个调用方。这些文件不隐藏任何逻辑，不是深层模块。

但它们提供 **导航价值**：文件名即文档（`openai-to-anthropic.ts`），让"哪个转换在哪里"一目了然。10 个文件的总 LOC 不到 200，合并的收益接近于零，还会丢失按文件名定位的便利性。

## Consequences

- 未来新增格式转换时，继续创建独立文件（如 `foo-to-bar.ts`），保持一致模式。
- 如果 converter 数量超过 20 个，重新评估是否需要按 API family 分目录组织。

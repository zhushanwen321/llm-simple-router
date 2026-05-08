# FormatAdapter + FormatConverter 注册表设计

## 背景

当前 `TransformCoordinator`（`transform/transform-coordinator.ts`，193 行）用 18 个 if-else 分支处理 3 种 API 格式（openai / anthropic / openai-responses）的 6 个转换方向 × 3 种操作（request / response / stream）。新增格式时分支数按 N×(N-1)×3 增长，维护成本急剧上升。

核心问题：**格式元数据**（路径、错误结构）和**方向转换逻辑**（请求体映射、响应转换）混在同一个类里，导致每新增一个格式，所有方法都要加分支。

## 设计决策

**区分"格式是什么"和"如何转换"：**

- **FormatAdapter** — 格式元数据（默认路径、错误格式、发送前钩子）。纯数据描述，不含方向逻辑，约 30 行。
- **FormatConverter** — 方向转换逻辑。每个 (source, target) 对一个实现，约 120 行，包含 request / response / stream 三种操作。
- **FormatRegistry** — 注册表，统一分发。消除 if-else，改为查表。

**错误转换无需 per-pair 实现**：统一提取 message，再由目标 adapter 的 `formatError()` 格式化。这把 6 个方向的错误处理收敛为一套通用逻辑。

## 接口定义

```typescript
// format/types.ts

/** 格式元数据 */
interface FormatAdapter {
  readonly apiType: string;
  readonly defaultPath: string;
  readonly errorMeta: Record<ErrorKind, { type: string; code: string }>;
  beforeSendProxy?(body: Record<string, unknown>, isStream: boolean): void;
  /** 将通用错误信息格式化为本格式的错误响应体 */
  formatError(message: string, code?: string): unknown;
}

/** 方向转换器，每个 (source, target) 对应一个实现 */
interface FormatConverter {
  readonly sourceType: string;
  readonly targetType: string;
  transformRequest(body: Record<string, unknown>, model: string): { body: Record<string, unknown>; upstreamPath: string };
  transformResponse(bodyStr: string): string;
  createStreamTransform(model: string): Transform;
}
```

```typescript
// format/registry.ts

class FormatRegistry {
  registerAdapter(adapter: FormatAdapter): void;
  registerConverter(converter: FormatConverter): void;
  getAdapter(apiType: string): FormatAdapter | undefined;

  needsTransform(source: string, target: string): boolean;
  transformRequest(body: any, source: string, target: string, model: string): { body: any; upstreamPath: string };
  transformResponse(bodyStr: string, source: string, target: string): string;
  transformError(bodyStr: string, source: string, target: string): string;
  createStreamTransform(source: string, target: string, model: string): Transform | undefined;
}
```

## 目录结构

```
format/
├── registry.ts               (~80 行) 注册表 + 分发逻辑
├── types.ts                  (~40 行) 接口定义
├── adapters/
│   ├── openai.ts             (~30 行)
│   ├── anthropic.ts          (~30 行)
│   └── responses.ts          (~30 行)
├── converters/
│   ├── openai-anthropic.ts   (~120 行)
│   ├── anthropic-openai.ts
│   ├── openai-responses.ts
│   ├── responses-openai.ts
│   ├── responses-anthropic.ts
│   └── anthropic-responses.ts
└── mappers/                  (从 transform/ 迁入，复用现有映射函数)
    ├── message-mapper.ts
    ├── tool-mapper.ts
    ├── thinking-mapper.ts
    └── usage-mapper.ts
```

## 与当前代码的映射

| 当前 | 重构后 | 说明 |
|------|--------|------|
| `TransformCoordinator` 18 个 if-else | `FormatRegistry` 查表 | 分发逻辑从 O(N²) 分支降为 O(1) 查表 |
| 分散在各方法中的错误格式化 | `FormatAdapter.formatError()` | 每种格式一个实现，错误转换通用化 |
| `beforeSendProxy()` 内的 if-else | `FormatAdapter.beforeSendProxy()` | 每种格式自带钩子，无需分支 |
| `transform/` 目录下的 mapper 函数 | `format/mappers/` | 直接迁入，不改逻辑 |
| 每个 transform 方法内混合多种格式 | 每个 `FormatConverter` 只关心一对方向 | 职责单一，新增格式只需写 adapter + N-1 个 converter |

**新增格式的成本：** 1 个 adapter（~30 行）+ N-1 个 converter（每个 ~120 行）。无需修改 registry 或已有 adapter/converter。

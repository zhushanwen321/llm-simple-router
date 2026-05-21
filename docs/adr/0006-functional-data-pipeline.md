# ADR 0006: 函数式数据管线替代 in-place mutation

代理请求的日志记录管线原来通过 in-place mutation 加工数据（修改请求体、注入字段、追加元数据）。这种模式导致数据流不可追踪、测试依赖共享可变状态、pipeline_snapshot 和实际 body 可能不一致。

选定方案：消除 in-place mutation，每个加工函数接收 body 返回 `{ body, meta }` 元组。body 作为值在管线中流动，meta 累积到 pipeline_snapshot。不引入类层次/责任链模式。

## Considered Options

1. **责任链模式（Chain of Responsibility）**：各阶段接口差异大（有的只改 header、有的改 body 结构、有的只提取元数据），控制流非线性（有条件跳过），过重。
2. **RxJS/Observable 管线**：引入重依赖，SSE 场景收益有限。
3. **中间件栈（Redux 风格 next()）**：控制流非线性，next() 调用点不统一。
4. **选定方案**：纯函数管线，每步返回新值，调用链显式组合。

## Consequences

- 每个 pipeline stage 是纯函数，可独立单元测试（输入 body → 输出 `{ body, meta }`）。
- pipeline_snapshot 天然完整（所有 meta 自动累积），不需要额外逻辑保证一致性。
- 内存开销略高于 in-place（每次创建新对象），但代理请求体通常 < 100KB，忽略不计。
- 新增 stage 只需写一个函数并插入调用链，不改动已有 stage。
- client_response 不独立存储：可从 upstream_response + pipeline_snapshot.response_transform 推导，不值得增加写入开销。

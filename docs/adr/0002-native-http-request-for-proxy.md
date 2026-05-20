# ADR 0002: 原生 http.request 替代 axios 做代理传输

代理层使用 Node.js 原生 `http.request` 直接操作上游连接，而非 axios 或其他 HTTP 库。原因是 SSE 流式代理需要逐 chunk 转发上游响应，axios 的响应聚合模型会把整个流缓冲后才返回，丧失流式特性。原生 http.request 提供了对连接生命周期的完整控制——可以按需写入请求体、逐块读取响应、在中途中断连接时清理资源。

## Considered Options

1. **axios**：API 友好但响应聚合，需要 adapter 层才能流式转发，本质上是在绕过它的核心抽象。
2. **node-fetch / undici**：支持流式但仍是高级抽象，SSE 场景下对背压、连接中断的处理不够精细。
3. **选定方案**：原生 `http.request`。开发成本高但零抽象层，对流式代理的控制最精确。

## Consequences

- Transport 层代码量显著高于使用 HTTP 库的方案（手动构建请求、处理响应、错误分类）。
- 未来如果需要支持 HTTP/2 或 WebSocket 代理，需要额外适配层。
- 测试中模拟上游响应使用 `http.createServer()`，与生产代码的抽象层级一致。

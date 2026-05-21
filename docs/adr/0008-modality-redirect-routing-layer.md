# ADR 0008: 模态重定向作为路由预计算层

当请求包含图片/音频/视频但当前映射的模型不支持对应模态时，需要自动切换到支持该模态的模型。这个能力本质上是路由决策，不是请求体变换。

选定方案：IR（Modality Redirect）作为独立路由预计算层，位于 resolveMapping 之后、Overflow 之前。不用 Pipeline Hook（纯同步逻辑不需要 emit/ctx 往返），用工具函数一次调用完成。image-redirect 泛化为 modality-redirect，单一 fallback target 覆盖所有非文本模态。

## 路由层顺序

```
resolveMapping → IR（Modality Redirect）→ OF（Overflow）→ Failover
```

每层仅扩展 target 列表，不修改请求体。IR 在 OF 之前是因为 overflow 检测依赖正确的模型——如果模型因模态不匹配而失败，overflow 检测没有意义。

## 单一 fallback target 理由

85% 多模态模型只支持 image+text，audio/video 模型必然也支持 image（超集关系）。多 target 增加配置复杂度但实际覆盖率提升有限。新增 fallback capabilities 检查：fallback 模型不支持缺失模态时不 redirect（避免无效 fallback）。

## Considered Options

1. **Pipeline Hook 实现（pre_route 阶段）**：路由预计算是纯同步逻辑，不需要 emit/ctx 往返，过重。
2. **请求体变换（改写 model 字段）**：破坏原始请求语义，日志不可追踪。
3. **每种模态独立 fallback target**：配置复杂度高，实际覆盖率提升有限。
4. **选定方案**：路由预计算层 + 单一 fallback target + 工具函数。

## Consequences

- 路由层顺序固定，新增路由逻辑必须确定插入位置。
- modality-redirect 只扩展 target 列表，请求体不变，日志中 mappingReason 清晰记录原因。
- 单一 fallback target 意味着 audio-only 模型如果没有 image 能力会被错误地 fallback 到 image 模型（实践中这种模型不存在）。
- detectModalities() 遍历所有 messages 检测模态，请求体很大时有性能开销（compact 是天然的过期机制）。
- IR fallback target 不参与 overflow 重定向：fallback 模型通常已是大上下文模型，overflow 无意义。

# Summary: 图片检测自动切换多模态模型

## 阶段 2 - T4 编码实现

- 状态：done
- 变更文件：`router/src/proxy/routing/overflow.ts`
- 摘要：新增 `expandOverflowTargets()` 导出函数，为每个 target 调用 `applyOverflowRedirect()` 预计算溢出重定向，溢出目标插入原 target 之前，单 target 异常不阻塞其他。4 个测试全部通过。
- 时间：2026-05-15T23:42:00Z

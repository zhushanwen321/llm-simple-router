# Summary: 图片检测自动切换多模态模型

## 阶段 2 - T4 编码实现

- 状态：done
- 变更文件：`router/src/proxy/routing/overflow.ts`
- 摘要：新增 `expandOverflowTargets()` 导出函数，为每个 target 调用 `applyOverflowRedirect()` 预计算溢出重定向，溢出目标插入原 target 之前，单 target 异常不阻塞其他。4 个测试全部通过。
- 时间：2026-05-15T23:42:00Z

## 阶段 3 - T6 编码实现

- 状态：done
- 变更文件：`router/src/admin/groups.ts`
- 摘要：在 `validateRule()` 函数中新增 `image_fallback` 字段校验：检查 provider_id 非空、backend_model 非空、provider 存在且 is_active。向后兼容（无 image_fallback 时跳过）。8 个测试全部通过，已有 15 个 admin-groups 测试无回归。
- 时间：2026-05-15T23:44:30Z

## 阶段 4 - T1 编码实现

- 状态：done
- 变更文件：`router/src/config/model-context.ts`
- 摘要：实现已就绪 — ModelEntry/ModelInfo 接口含 capabilities 字段、MODEL_CAPABILITIES 白名单常量、parseModels() 三级回退（显式 > 白名单 > 默认 text）、buildModelInfoList() 透传 capabilities。8 个测试全部通过。
- 时间：2026-05-15T23:52:00Z

## 阶段 4 - T1 编码实现（修复）

- 状态：done
- 变更文件：`router/src/config/model-context.ts`, `router/tests/model-context.test.ts`
- 摘要：修复缩进问题（edit 工具受 .editorconfig 影响导致缩进异常），更新现有 model-context.test.ts 中的 4 个 toEqual 断言以包含 capabilities 字段。22 个测试全部通过，lint 零新增警告，tsc 编译通过。
- 时间：2026-05-15T23:57:00Z

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

## 阶段 5 - T2 编码实现

- 状态：done
- 变更文件：`router/src/proxy/routing/image-redirect.ts`（新建）
- 摘要：实现 IR 层纯函数 `computeImageRedirectTargets()` 和 `hasImage()`。hasImage 检测三种 API 图片格式（OpenAI image_url、Anthropic image、Responses API input_image）。主函数流程：hasImage → 首target capabilities 检查 → fallback 配置查找 → provider 存活校验 → prepend + snapshot 记录。异常安全（try-catch 返回原 targets）。16/16 测试通过。
- 时间：2026-05-15T23:58:00Z

## 阶段 6 - T3 编码实现（failover-loop 重构）

- 状态：done
- 变更文件：`router/src/proxy/handler/failover-loop.ts`, `router/src/proxy/pipeline-snapshot.ts`, `router/src/proxy/routing/image-redirect.ts`
- 摘要：将 failover-loop.ts 的 while(true) 循环重构为分层预计算模型。resolveMapping/IR/OF 三层在循环外执行，循环简化为纯执行+exclude。同时为 IR 层所有 early-return 路径添加 triggered:false 的 StageRecord，确保 pipeline_snapshot 总是包含 image-redirect stage。修复 pipeline-snapshot 构造函数接受 readonly 参数。修复 image-redirect.ts 的 import 路径。117/117 测试文件、1401/1401 测试通过，零回归。
- 时间：2026-05-16T00:10:00Z

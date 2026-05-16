# Plan: 多模态重定向（Modality Redirect）

## 概述

将 image-only 的 IR 层泛化为多模态重定向层。~25 个文件变更，大部分是机械重命名。

## 依赖关系

```
后端:
  T1 (pipeline-snapshot 类型) ──┐
  T4 (admin 校验) ──────────────┼── 可并行
  T5 (MODEL_CAPABILITIES 数据) ─┘
     ↓
  T2 (modality-redirect 核心) ← 依赖 T1
     ↓
  T3 (failover-loop 调用方) ← 依赖 T2

前端:
  F6 (i18n) → F1 (类型重命名) → F3 (ModelMappings.vue)
               → F2 (ModelMappingCard + Alert)
       F4 (toggleCapability) → F5 (ModelCard + Editor)

测试:
  T6 (全量测试更新) ← 依赖 T1-T5 + F1-F6

验证:
  T7 (全局验证)
```

---

## 后端任务

### T1: 更新 PipelineSnapshot StageRecord 类型

| 文件 | 操作 |
|------|------|
| `router/src/proxy/pipeline-snapshot.ts` | `image-redirect` → `modality-redirect`；增加 `detected_modalities?: string[]` |

AC: StageRecord union 中无 `image-redirect`；`detected_modalities` 可选字段类型正确；tsc 编译通过

### T2: 重命名 + 重构 modality-redirect 核心文件

| 文件 | 操作 |
|------|------|
| `router/src/proxy/routing/image-redirect.ts` | **重命名** → `modality-redirect.ts` |

关键变更：
- `hasImage()` → `detectModalities()` 返回 `Set<string>`（检测 image + audio）
- `supportsImage()` → `supportsModality(capabilities, modality)`
- `computeImageRedirectTargets` → `computeModalityRedirectTargets`
- `rule.image_fallback` → `rule.multimodal_fallback`
- **新增步骤 6**：检查 fallback 模型 capabilities 是否覆盖缺失模态
- 所有 reason 按映射表更新

**首 target capabilities 获取**：保持现有两级 fallback 机制（先从 provider 的 `parseModels()` 结果中查找 model entry 的 capabilities，找不到则 fallback 到 `lookupCapabilities()`）。这与当前代码逻辑一致。

**Responses API audio 检测说明**：`input_audio` 只出现在 Responses API 的顶层 `input[]` 中，不会出现在 `message.content[]` 中（API 规范决定：audio 是 realtime 概念，不在 message 对话结构中）。因此 `detectModalities()` 只在顶层检测 `input_audio`，`message.content[]` 只检测 `input_image`。

### T3: 更新 failover-loop.ts 调用方

| 文件 | 操作 |
|------|------|
| `router/src/proxy/handler/failover-loop.ts` | import 路径 + 函数名替换 |

### T4: 更新 admin groups.ts 校验

| 文件 | 操作 |
|------|------|
| `router/src/admin/groups.ts` | `image_fallback` → `multimodal_fallback` 字段名 + 错误消息 |

### T5: 扩展 MODEL_CAPABILITIES 数据

| 文件 | 操作 |
|------|------|
| `router/src/config/model-context.ts` | 8 个模型增加 audio/video |

| 模型 | 新值 |
|------|------|
| kimi-k2.6, kimi-k2.5 | `["text", "image", "video"]` |
| qwen3.5-plus, qwen3.6-plus | `["text", "image", "video"]` |
| doubao-seed-2-0-pro-260215 | `["text", "image", "video"]` |
| mimo-v2-omni, mimo-v2.5, glm-5v-turbo | `["text", "image", "audio", "video"]` |

---

## 前端任务

### F1: 类型重命名

| 文件 | 操作 |
|------|------|
| `frontend/src/types/mapping.ts` | `ImageFallback` → `MultimodalFallback`；`image_fallback` → `multimodal_fallback` |
| `frontend/src/components/quick-setup/types.ts` | re-export + MappingEntry 字段重命名 |

### F2: ModelMappingCard 重命名 + Alert 警告

| 文件 | 操作 |
|------|------|
| `frontend/src/components/mappings/ModelMappingCard.vue` | 重命名引用 + 新增 Alert 警告 |

Alert 在 `localMultimodalFallback` 有值时显示，内容包含：
- 会话锁定警告
- 原因说明
- 恢复方式
- 成本建议

使用 `AlertTriangle` lucide 图标 + amber 语义色。

### F3: ModelMappings.vue 字段名更新

| 文件 | 操作 |
|------|------|
| `frontend/src/views/ModelMappings.vue` | `rule.image_fallback` → `rule.multimodal_fallback` |

### F4: toggleModelCapability 泛化

| 文件 | 操作 |
|------|------|
| `frontend/src/composables/useProviderForm.ts` | `toggleModelImageCapability(index)` → `toggleModelCapability(index, capability)` |
| `frontend/src/views/QuickSetup.vue` | 本地函数重命名 + 参数化 |

### F5: ModelCard + ModelCapabilitiesEditor 事件名和 UI 扩展

| 文件 | 操作 |
|------|------|
| `frontend/src/components/quick-setup/ModelCard.vue` | emit 重命名 + 新增 audio/video checkbox + Volume2/Video 图标 |
| `frontend/src/components/providers/ModelCapabilitiesEditor.vue` | emit 重命名 + 传递 capability 参数 |
| `frontend/src/views/Providers.vue` | emit 事件名更新 |

### F6: i18n 更新

| 文件 | 操作 |
|------|------|
| `frontend/src/i18n/locales/zh-CN/mappings.json` | `imageFallback` → `multimodalFallback` + 新增 warning keys |
| `frontend/src/i18n/locales/en/mappings.json` | 同上 |
| `frontend/src/i18n/locales/zh-CN/providers.json` | capabilities 加 `"audio": "音频"`, `"video": "视频"` |
| `frontend/src/i18n/locales/en/providers.json` | capabilities 加 `"audio": "Audio"`, `"video": "Video"` |

---

## 测试任务

### T6: 更新所有测试文件

| 文件 | 操作 |
|------|------|
| `router/tests/image-redirect.test.ts` | **重命名** → `modality-redirect.test.ts` + 全面更新 |
| `router/tests/failover-loop-layered.test.ts` | 机械替换 stage 名/字段名 |
| `router/tests/admin-groups-validation.test.ts` | `image_fallback` → `multimodal_fallback` |
| `router/tests/pipeline-snapshot.test.ts` | stage 名 + detected_modalities |

新增测试：AC4 (audio 检测)、AC5 (空 body)、AC6 (混合模态)、AC10 (fallback-missing-modality)、AC11 (fallback 支持所有模态)

---

## 全局验证（T7）

```bash
# 编译
cd router && npx tsc --noEmit

# 全量测试
cd router && npm test

# Lint
cd router && npm run lint
cd frontend && npx eslint . --max-warnings=0

# 旧引用检查
grep -rn "image-redirect\|image_fallback\|ImageFallback\|hasImage\|supportsImage\|computeImageRedirect\|toggleModelImageCapability\|toggle-image-capability\|toggle-model-image-capability" router/src/ router/tests/ frontend/src/ --include="*.ts" --include="*.vue"

# 前端类型检查
cd frontend && npx vue-tsc -b --noEmit
```

---

## 实现顺序

```
阶段 1（并行 3 个 subagent，SA1 内部串行）:
  SA1: T1 → T2 → T3（后端核心链路，串行执行）
  SA2: T4 + T5（后端辅助，仅文本替换，不做编译验证）
  SA3a: F6 + F1 + F3（前端基础重命名，~4 文件）

阶段 2（SA1 完成后）:
  SA3b: F4 + F5 + F2（前端功能扩展，~5 文件）

阶段 3（SA1+SA3b 完成后）:
  T6（全量测试更新 + 编译验证）

阶段 4:
  T7（全局验证）
```

说明：
- SA1 内部必须串行：T1(类型) → T2(核心实现) → T3(调用方)，因为 T2 依赖 T1 的类型定义
- SA2 的 T4/T5 与 SA1 无依赖，可并行，但 SA2 不做编译验证（因为 T2 的重命名未完成时 import 路径不一致）
- SA3a 拆出前端基础重命名（类型+字段名+i18n），轻量可快速完成
- SA3b 在 SA3a 基础上做功能扩展（Alert、checkbox、emit 泛化）
- T6 必须等 SA1 完成后才能执行（测试引用 T2 的新函数名和文件路径）

---

## AC 覆盖矩阵

| AC | Task | 测试/验证方式 |
|----|------|-------------|
| AC1 | T2, T6 | detectModalities OpenAI image_url |
| AC2 | T2, T6 | detectModalities Anthropic image + tool_result |
| AC3 | T2, T6 | detectModalities Responses API input_image |
| AC4 | T2, T6 | detectModalities OpenAI input_audio（新增） |
| AC5 | T2, T6 | detectModalities 空 body/空 messages |
| AC6 | T2, T6 | detectModalities 混合 image+audio（新增） |
| AC7 | T2, T6 | 首 target 支持所有模态 → 不 redirect |
| AC8 | T2, T6 | 首 target 不支持 → redirect |
| AC9 | T2, T6 | 无 multimodal_fallback 配置 → 不 redirect |
| AC10 | T2, T6 | fallback 缺模态 → 不 redirect（新增） |
| AC11 | T2, T6 | fallback 支持所有模态 → redirect（新增） |
| AC12 | T2, T6 | fallback provider inactive → 不 redirect |
| AC13 | T2, T6 | 无 mapping group → 不 redirect |
| AC14 | T2, T6 | rule 解析失败 → 不 redirect |
| AC15 | T2, T6 | 内部异常 → 返回原始 targets |
| AC16 | T1, T6 | pipeline snapshot stage 名 + detected_modalities |
| AC17 | T4, T6 | admin multimodal_fallback 校验 |
| AC18 | F2 | 前端 Alert 显示（手动验证：ModelMappings 页面 → 编辑映射组 → 添加 multimodal fallback → 确认琥珀色警告框显示） |
| AC19 | F4, F5 | 前端 capabilities 切换泛化（手动验证：Providers 页面 → 编辑模型 → 确认 image/audio/video 三个 checkbox 均可切换） |
| AC20 | T7 | 全量 CI 通过 |
| AC21 | T7 | grep 无残留旧引用 |

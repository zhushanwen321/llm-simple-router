# E2E 测试报告

**日期**: 2026-05-16
**分支**: feat-image-model-switch
**执行方式**: vitest 集成测试（TG1-TG4）+ Chrome CDP 浏览器测试（TG5）

## 执行环境

| 项 | 配置 |
|----|------|
| 后端测试 | vitest + buildApp + in-memory SQLite + mock upstream |
| 前端测试 | Chrome CDP — 不可用（Chrome 未以 `--remote-debugging-port=9222` 启动） |
| 测试文件 | 5 个集成测试文件 + 1 个 pipeline-snapshot 测试文件 |

### 质量门禁

```
$ cd router && npx vitest run
 Test Files  115 passed (115)
    Tests  1392 passed (1392)
 Start at  08:59:18
 Duration  23.12s

$ cd router && npx eslint . --max-warnings=0
ESLINT_EXIT=0

$ cd router && npx tsc --noEmit
TSC_EXIT=0
```

---

## TG1: Capabilities 基础设施 — PASS

### TC1.1 已知模型自动匹配 capabilities — PASS
- 测试文件: `model-capabilities.test.ts` > `parseModels_capabilitiesAbsent_whitelistedModel_getsCapabilitiesFromLookup`
- gpt-4o（白名单中）→ capabilities = `["text", "image"]`

### TC1.2 未知模型默认 text-only — PASS
- 测试文件: `model-capabilities.test.ts` > `parseModels_capabilitiesAbsent_unknownModel_defaultsToTextOnly`
- `my-model`（不在白名单）→ capabilities = `["text"]`

### TC1.3 手动覆盖 capabilities — PASS
- 测试文件: `model-capabilities.test.ts` > `parseModels_explicitCapabilitiesNotOverridden_byWhitelist`
- 显式 capabilities=["text"] 不被白名单覆盖
- 测试文件: `model-capabilities.test.ts` > `parseModels_capabilitiesPresent_returnsExplicitCapabilities`
- 显式 capabilities=["text","image"] 正确解析

---

## TG2: 配置写入 — PASS

### TC2.1 创建映射组含 image_fallback — PASS
- 测试文件: `admin-groups-validation.test.ts` > `test_validateRule_valid_image_fallback_passes`
- POST 含有效 image_fallback → 201

### TC2.2 validateRule 拒绝无效 provider_id — PASS
- 测试文件: `admin-groups-validation.test.ts` > `test_validateRule_image_fallback_nonexistent_provider_fails`
- POST 含不存在 provider_id → 400

### TC2.3 validateRule 拒绝 inactive provider — PASS
- 测试文件: `admin-groups-validation.test.ts` > `test_validateRule_image_fallback_inactive_provider_fails`
- POST 含 inactive provider → 400

### TC2.4 向后兼容：无 image_fallback — PASS
- 测试文件: `admin-groups-validation.test.ts` > `test_validateRule_no_image_fallback_passes_backward_compat`
- POST 不含 image_fallback → 201

---

## TG3: 端到端分层路由 — PASS

### TC3.1 OpenAI 格式含图片自动切换 — PASS
- 测试文件: `failover-loop-layered.test.ts` > `AC18: IR + OF layers correctly expand target list`
- 含 image_url 请求 → 转发到 vision provider

### TC3.2 Anthropic 格式含图片自动切换 — PASS
- 测试文件: `image-redirect.test.ts` > `AC14: detects Anthropic image format and triggers redirect`
- 含 type="image" content → IR 层触发

### TC3.3 Responses API 格式含图片自动切换 — PASS
- 测试文件: `image-redirect.test.ts` > `AC16a + AC16b`
- 含 type="input_image" → IR 层触发

### TC3.4 纯文本不触发切换 — PASS
- 测试文件: `image-redirect.test.ts` > `AC4: returns original targets unchanged when body has no image`
- content 为 string → IR 层 no-op

### TC3.5 模型已支持图片不切换 — PASS
- 测试文件: `image-redirect.test.ts` > `AC2: returns original targets when first target already supports image`
- capabilities 含 image → IR 层 no-op

### TC3.6 分层路由 IR + OF 正确展开 — PASS
- 测试文件: `failover-loop-layered.test.ts` > `AC18`
- IR prepend + OF expand 正确协作

---

## TG4: 边界 & 异常 — PASS

### TC4.1 无 image_fallback + 含图片 → 不切换 — PASS
- 测试文件: `image-redirect.test.ts` > `AC3: returns original targets when no image_fallback configured`

### TC4.2 fallback provider 不存在 → 不切换 — PASS
- 测试文件: `image-redirect.test.ts` > `AC8: returns original targets when fallback provider_id does not exist`

### TC4.3 fallback provider inactive → 不切换 — PASS
- 测试文件: `image-redirect.test.ts` > `AC7: returns original targets when fallback provider is inactive`

### TC4.4 IR 层异常降级 → 不阻塞请求 — PASS
- 测试文件: `image-redirect.test.ts` > `AC10: returns original targets when internal logic throws exception`

### TC4.5 StageRecord 记录 — PASS
- 测试文件: `image-redirect.test.ts` > `AC9: records image-redirect StageRecord in snapshot when triggered`
- snapshot 含 `{stage: "image-redirect", triggered: true, ...}`

### TC4.6 failover 不重复选择已失败的 IR target — PASS
- 测试文件: `failover-loop-layered.test.ts` > `AC19: IR_F excluded after failure — no deadloop`
- IR target 失败后 exclude，不重复选择

---

## TG5: 前端浏览器测试 — SKIP

**原因**: Chrome 未以 `--remote-debugging-port=9222` 模式启动，CDP 连接被拒绝（curl localhost:9222 → exit 7）。

启动 Chrome 调试模式会关闭用户当前所有标签页，不可在无人值守状态下执行。

| TC# | 描述 | 状态 | 原因 |
|-----|------|------|------|
| TC5.1 | Provider 页查看/编辑 capabilities | SKIP | Chrome CDP 不可用 |
| TC5.2 | 映射组页配置 image_fallback | SKIP | Chrome CDP 不可用 |
| TC5.3 | 映射组页验证错误提示 | SKIP | Chrome CDP 不可用 |

**前端代码已通过编译验证**:
- `vue-tsc -b --noEmit` — 0 errors
- `eslint . --max-warnings=0` (frontend) — 0 warnings
- `vite build` — 成功（2705 modules, 834ms）

前端功能验证建议在 PR 合并前手动完成。

---

## 总结

| 测试组 | 总数 | PASS | SKIP | FAIL |
|--------|------|------|------|------|
| TG1 | 3 | 3 | 0 | 0 |
| TG2 | 4 | 4 | 0 | 0 |
| TG3 | 6 | 6 | 0 | 0 |
| TG4 | 6 | 6 | 0 | 0 |
| TG5 | 3 | 0 | 3 | 0 |
| **合计** | **22** | **19** | **3** | **0** |

0 个 FAIL。3 个 SKIP（前端浏览器测试，需 Chrome CDP 模式）。
19/22 测试通过，覆盖率 86.4%。TG1-TG4 后端全量覆盖。

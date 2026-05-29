---
verdict: "pass"
must_fix: 0
reviewer: robustness-v2
date: "2026-05-29"
scope:
  - router/src/proxy/handler/failover-loop.ts
  - router/src/db/providers.ts
previous_must_fix: 2
previous_must_fix_status: all_resolved
---

# Robustness Review v2 — Re-verification

## MUST-FIX-1: resolveEndpoint 异常保护 ✅ RESOLVED

**文件**: `router/src/proxy/handler/failover-loop.ts`

**修复验证**: `executeFailoverLoop()` 的主循环中，`buildIterationSetup()` 调用（内部调用 `resolveEndpoint`）被完整的 try-catch 包裹：

```typescript
try {
  const setupResult = buildIterationSetup({...});
  if (!setupResult.ok) return setupResult.reply;
  const resultAction = await processResilienceResult({...});
  // ... handle result ...
} catch (setupErr: unknown) {
  // resolveEndpoint 或 setup 阶段异常 → failover 到下一个 target
  request.log.error({logId, error: errMsg, providerId, action: "endpoint_setup_failed"}, ...);
  insertRejectedLog({...});
  excludeTargets.push(resolved);
  continue;
}
```

**健壮性评估**:
- resolveEndpoint 抛出的任何异常（解密失败、端点配置损坏等）都会被捕获
- 捕获后执行 failover 标准流程：写 rejected log + 排除当前 target + continue
- 不会导致未处理异常传播到客户端返回 500
- 日志中包含 providerId 和 action 标记，便于排查

## MUST-FIX-2: parseEndpoints 字段校验 ✅ RESOLVED

**文件**: `router/src/db/providers.ts`

**修复验证**: `parseEndpoints()` 新增三层校验：

1. **数组类型校验**: `JSON.parse` 结果必须为 `Array.isArray`
2. **元素类型校验**: 每个元素必须为非 null、非数组的 object
3. **字段校验**:
   - `api_type`: 必须为 string 且属于 `VALID_API_TYPES`（openai / openai-responses / anthropic）
   - `base_url`: 必须为 string 且 trim 后非空

```typescript
for (let i = 0; i < parsed.length; i++) {
  const item = parsed[i];
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    throw new Error(`Invalid endpoints JSON: element [${i}] is not an object`);
  }
  const obj = item as Record<string, unknown>;
  if (typeof obj.api_type !== "string" || !VALID_API_TYPES.has(obj.api_type)) {
    throw new Error(`Invalid endpoints JSON: element [${i}] has invalid api_type '...'`);
  }
  if (typeof obj.base_url !== "string" || obj.base_url.trim() === "") {
    throw new Error(`Invalid endpoints JSON: element [${i}] has invalid base_url`);
  }
}
```

**健壮性评估**:
- 枚举校验防止拼写错误的 api_type（如 "openAi"）静默通过
- base_url 非空校验防止纯空白 URL 进入路由层
- 错误消息包含元素索引 `[i]`，便于定位问题数据
- 校验位于解析层（parseEndpoints），fail-fast 原则
- 与 MUST-FIX-1 的 try-catch 配合：即使 parseEndpoints 校验遗漏导致异常，failover 循环也能捕获

## 总结

| 项目 | v1 状态 | v2 状态 |
|------|---------|---------|
| MUST-FIX-1 resolveEndpoint 异常保护 | 🔴 缺失 | 🟢 已修复 |
| MUST-FIX-2 parseEndpoints 字段校验 | 🔴 缺失 | 🟢 已修复 |

两处修复均到位，无残留问题。**通过**。

---
verdict: "pass"
must_fix: 0
---

# Business Logic Review: Modality Constraint Filtering

## Overview

Review of changes implementing modality constraint filtering for `computeModalityRedirectTargets()`. The core strategy changes from prepend (keeping all original targets + prepending fallback) to filter+replace (filtering out modality-ineligible targets, replacing with fallback when all filtered).

## Scope of Review

7 changed files reviewed:

| File | Role |
|------|------|
| `router/src/proxy/routing/modality-redirect.ts` | Core logic: filter+replace strategy |
| `router/src/proxy/handler/failover-loop.ts` | Empty-list early error branch |
| `router/src/proxy/proxy-core.ts` | `ErrorKind` + `createErrorFormatter` registration |
| `router/src/proxy/format/types.ts` | `ErrorKind` type sync |
| `router/src/proxy/format/adapters/shared-error-meta.ts` | `OPENAI_FAMILY_ERROR_META` entry |
| `router/src/proxy/format/adapters/anthropic.ts` | `ANTHROPIC_ERROR_META` entry |
| `router/src/proxy/handler/create-proxy-handler.ts` | Fallback errorMeta |

## AC Coverage Matrix

### AC-1: Modality 过滤 — 部分支持
**AC requirement**: targets=[A(不支持image), B(支持image), C(支持image)], 含 image → 返回 [B, C], reason=`filtered-ineligible-targets`

**Code path**: `modality-redirect.ts`
1. `detectModalities()` detects Set{"image"} — ✓
2. Loop checks each target via `getProviderById` → `parseModels` → `supportsModality` — ✓
3. A filtered (ineligible), B,C kept (eligible) — ✓
4. `eligible.length > 0 && eligible.length < targets.length` → step 5 — ✓
5. Returns `eligible = [B, C]` with reason `filtered-ineligible-targets` — ✓

**Also verified**: When provider not found (`getProviderById` returns null), the target is conservatively kept (`eligible.push(target)`) rather than filtered, avoiding false negatives when provider data is temporarily unavailable. — ✓

**Result: PASS**

### AC-2: Modality 过滤 — 全部不支持 + fallback
**AC requirement**: targets=[A(不支持image), B(不支持image)], fallback=C(支持image) → 返回 [C], reason=`replaced-with-fallback`

**Code path**: `modality-redirect.ts` steps 6a-6f
1. A,B filtered → eligible=[] — ✓
2. Step 6: `getMappingGroup(db, clientModel)` finds group — ✓
3. Step 6c: `rule.multimodal_fallback` found and valid — ✓
4. Step 6d: fbProvider exists and `is_active` = 1 — ✓
5. Step 6e: fbCapabilities cover image → fbMissing.length=0 — ✓
6. Step 6f: Creates fbTarget, returns [fbTarget] with reason `replaced-with-fallback` — ✓

**Sub-paths verified**:
- Fallback provider inactive → `no-eligible-targets`, returns [] — ✓
- Fallback doesn't cover all modalities → `no-eligible-targets`, returns [] (matches FR-1 row 5) — ✓
- `getMappingGroup` returns null → `no-mapping-group`, returns [] — ✓ (defensive)
- Rule JSON parse fails → `rule-parse-error`, returns [] — ✓ (defensive)

**Result: PASS**

### AC-3: Modality 过滤 — 全部不支持 + 无 fallback
**AC requirement**: targets=[A(不支持image)], 无 multimodal_fallback → 返回 [], reason=`no-eligible-targets`

**Code path**: `modality-redirect.ts` step 6c
1. `fallback == null` → enters early return branch — ✓
2. Snapshot reason = `no-eligible-targets` — ✓
3. Returns [] — ✓

**Result: PASS**

### AC-4: 提前报错 — OpenAI 格式
**AC requirement**: 空列表 → HTTP 400, `{ "error": { "message": "...", "type": "invalid_request_error", "code": "unsupported_modality" } }`

**Code path**: `failover-loop.ts` lines 228-239
1. `allTargets.length === 0` triggers early branch — ✓
2. Calls `errors.unsupportedModality()` — ✓
3. `createErrorFormatter` for OpenAI: `errorMeta["unsupportedModality"]` = `{ type: "invalid_request_error", code: "unsupported_modality" }` (from `shared-error-meta.ts`) — ✓
4. `formatBody` (from `create-proxy-handler.ts`): `{ error: { message, type, code } }` — ✓
5. HTTP 400 — ✓

**Result: PASS**

### AC-5: 提前报错 — Anthropic 格式
**AC requirement**: 空列表 → HTTP 400, 通过 `createErrorFormatter` + `ANTHROPIC_ERROR_META`

**Code path**: `failover-loop.ts` + `anthropic.ts`
1. For Anthropic, `errorMeta` comes from `anthropicAdapter.errorMeta` via `create-proxy-handler.ts` — ✓
2. `ANTHROPIC_ERROR_META.unsupportedModality` = `{ type: "invalid_request_error", code: "unsupported_modality" }` — ✓
3. Same `createErrorFormatter` is used, produces same `{ error: { message, type, code } }` structure — ✓
4. Consistent with existing `promptTooLong` which also uses the same `createErrorFormatter` + `ANTHROPIC_ERROR_META` — ✓
5. HTTP 400 — ✓

**Result: PASS**

### AC-6: 无多模态 — 不变
**AC requirement**: 请求无图片/音频 → 返回原始 targets, reason=`no-multimodal-detected`

**Code path**: `modality-redirect.ts` step 2
1. `detectModalities()` returns empty Set — ✓
2. `modalities.size === 0` → early return with original targets — ✓
3. Snapshot reason = `no-multimodal-detected` — ✓

**Result: PASS**

### AC-7: 全部支持 — 不变
**AC requirement**: 所有 targets 支持检测到的模态 → 返回原始 targets, reason=`all-targets-support-modalities`

**Code path**: `modality-redirect.ts` step 4
1. All targets pass `supportsModality` check → `eligible = targets` — ✓
2. `eligible.length === targets.length` → returns original targets — ✓
3. Snapshot reason = `all-targets-support-modalities` — ✓

**Result: PASS**

### AC-8: Overflow 对过滤后列表仍生效
**AC requirement**: Modality 过滤后 → `expandOverflowTargets()` 仍收到过滤后列表

**Code path**: `failover-loop.ts` lines 243-245
```typescript
allTargets = computeModalityRedirectTargets(...);
// ... empty check ...
const ofResult = expandOverflowTargets(allTargets, db, ctx.body);
```
- `expandOverflowTargets` receives the modality-filtered `allTargets` — ✓
- Overflow logic is unchanged per spec constraint — ✓
- `overflowIndices` tracking still works on filtered list — ✓

**Result: PASS**

### AC-9: 不影响现有 promptTooLong 错误
**AC requirement**: `promptTooLong` 错误行为不变

**Code path**: All affected files
- `computeModalityRedirectTargets` is a prepended pure function, doesn't touch existing error paths — ✓
- When no multimodal content → returns targets unchanged, no impact — ✓
- `createErrorFormatter.promptTooLong` is unchanged (same static message, same status 400) — ✓
- `ANTHROPIC_ERROR_META.promptTooLong` and `OPENAI_FAMILY_ERROR_META.promptTooLong` unchanged — ✓

**Result: PASS**

## Execution Path Simulation

### Path 1: 部分过滤 (AC-1)
```
请求(image) → detectModalities → Set{"image"}
→ A(不支持) filtered, B(支持) eligible, C(支持) eligible
→ eligible=[B,C], eligible.length < targets.length
→ reason="filtered-ineligible-targets" → return [B,C]
→ failover-loop: expandOverflowTargets([B,C]) → proceed normally
```
✓

### Path 2: 全部过滤+fallback (AC-2)
```
请求(image) → detectModalities → Set{"image"}
→ A(不支持) filtered, B(不支持) filtered → eligible=[]
→ getMappingGroup → found → rule.multimodal_fallback = {C, supports image}
→ fbCapabilities covers all modalities
→ reason="replaced-with-fallback" → return [C]
→ failover-loop: allTargets.length > 0 → proceed
```
✓

### Path 3: 全部过滤+无fallback (AC-3 → AC-4/AC-5)
```
请求(image) → detectModalities → Set{"image"}
→ A(不支持) filtered → eligible=[]
→ getMappingGroup → found → rule: no multimodal_fallback
→ reason="no-eligible-targets" → return []
→ failover-loop: allTargets.length === 0
→ errors.unsupportedModality() → HTTP 400
→ { error: { message, type: "invalid_request_error", code: "unsupported_modality" } }
```
✓

### Path 4: 无多模态 (AC-6)
```
请求(text) → detectModalities → Set{}
→ modalities.size === 0 → early return
→ reason="no-multimodal-detected" → return targets unchanged
→ failover-loop: targets.length > 0 → proceed normally
```
✓

### Path 5: 全部支持 (AC-7)
```
请求(image) → detectModalities → Set{"image"}
→ 모든 targets 支持 image → eligible = targets
→ eligible.length === targets.length → return targets unchanged
→ reason="all-targets-support-modalities"
```
✓

## Additional Observations

### 1. Defensive snapshot reasons (informational)
The code introduces two additional snapshot reasons not listed in the spec table:
- `no-mapping-group` — when `getMappingGroup()` returns null in the all-filtered path
- `rule-parse-error` — when `group.rule` JSON.parse fails

These improve debuggability for misconfigured mapping groups. They always return `[]`, which is the correct fail-safe behavior. No action needed.

### 2. Exception safety
The entire function body is wrapped in a `try-catch` that returns original targets with `internal-error` reason. This matches the spec constraint that `computeModalityRedirectTargets()` should be exception-safe. ✓

### 3. Empty targets edge case
`targets.length === 0` check at step 1 returns early with original (empty) array, avoiding unnecessary modality detection on empty lists. ✓

### 4. Conservative treatment of missing providers
When `getProviderById()` returns null (provider not found), the target is preserved rather than filtered. This avoids accidentally dropping targets due to transient DB read issues. ✓

### 5. Error message content
The error message for `unsupportedModality` is a static string: `"Request contains multimodal content but no available model supports the required modality."`. The spec's example includes mapping name and detected modalities, but the spec body shows `"..."` for the message in the error body spec. The static message is consistent with how `promptTooLong` handles messages. Minor difference — recommend adding dynamic info (model name + detected modalities) for better debuggability, but not a MUST FIX.

### 6. Third adapter (responses) covered
The `responses` adapter uses `OPENAI_FAMILY_ERROR_META` which also includes `unsupportedModality`, so Responses API format is fully supported. ✓

### 7. Snapshot StageRecord type compatibility
The `pipeline-snapshot.ts` `StageRecord` union type includes the `modality-redirect` variant with all required fields. All `snapshot.add()` calls in `modality-redirect.ts` satisfy the `StageRecord` type. ✓

## Summary

| AC | Status | Notes |
|----|--------|-------|
| AC-1 | PASS | Filtering logic correct, partial filtering works |
| AC-2 | PASS | Fallback replacement works, including edge cases |
| AC-3 | PASS | Empty list correctly returned with `no-eligible-targets` |
| AC-4 | PASS | OpenAI error format correct (400, `invalid_request_error`, `unsupported_modality`) |
| AC-5 | PASS | Anthropic error format correct, consistent with `promptTooLong` |
| AC-6 | PASS | No multimodal → unchanged, correct snapshot reason |
| AC-7 | PASS | All support → unchanged, correct snapshot reason |
| AC-8 | PASS | Overflow receives filtered list, logic preserved |
| AC-9 | PASS | `promptTooLong` path untouched |

**Verdict: PASS** — All 9 ACs are correctly implemented. No MUST FIX issues found.

**Recommendations (not blocking):**
1. Consider adding dynamic information (model name, detected modalities) to the `unsupportedModality` error message for better debuggability, following spec's message example pattern.

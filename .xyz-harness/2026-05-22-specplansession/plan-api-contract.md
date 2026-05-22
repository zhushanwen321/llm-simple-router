# Retry Rule Upgrade: API Contract

> This document defines the HTTP API contracts for the Retry Rule Provider Isolation and JSON Field Matching features. All endpoints are under `/admin/api/` with JWT authentication.

## Base URL

All endpoints: `/admin/api/retry-rules`

## Common Response Envelope

All Admin API responses are wrapped in `{ code, message, data }` via the on-send hook. The frontend `request<T>()` auto-unwraps `body.data`. For brevity, this document shows the unwrapped response body.

## GET /admin/api/retry-rules

Returns all retry rules ordered by `created_at DESC`.

### Response (200)

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "KIMI 429 速率限制",
    "status_code": 429,
    "body_pattern": "\"error\".*\"type\"\\s*:\\s*\"rate_limit_error\"",
    "body_matchers": "[{\"path\":\"error.type\",\"operator\":\"contains\",\"value\":\"rate_limit_error\"}]",
    "is_active": 1,
    "created_at": "2026-05-22T10:00:00.000Z",
    "retry_strategy": "exponential",
    "retry_delay_ms": 5000,
    "max_retries": 3,
    "max_delay_ms": 60000,
    "provider_id": "f822eb4a-1234-5678-9abc-def012345678"
  },
  {
    "id": "660e8400-e29b-41d4-a716-446655440001",
    "name": "OpenCode DeepSeek 速率限制",
    "status_code": 429,
    "body_pattern": "\"error\".*\"type\"\\s*:\\s*\"rate_limit_error\"",
    "body_matchers": null,
    "is_active": 1,
    "created_at": "2026-05-21T10:00:00.000Z",
    "retry_strategy": "exponential",
    "retry_delay_ms": 5000,
    "max_retries": 10,
    "max_delay_ms": 60000,
    "provider_id": null
  }
]
```

### New Fields

| Field | Type | Description |
|-------|------|-------------|
| `provider_id` | `string \| null` | Bound provider UUID. `null` = global rule |
| `body_matchers` | `string \| null` | JSON array string of BodyMatcher objects. `null` = use body_pattern regex |

## GET /admin/api/retry-rules/:id

Returns a single retry rule.

### Response (200)

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "KIMI 429 速率限制",
  "status_code": 429,
  "body_pattern": "\"error\".*\"type\"\\s*:\\s*\"rate_limit_error\"",
  "body_matchers": "[{\"path\":\"error.type\",\"operator\":\"contains\",\"value\":\"rate_limit_error\"}]",
  "is_active": 1,
  "created_at": "2026-05-22T10:00:00.000Z",
  "retry_strategy": "exponential",
  "retry_delay_ms": 5000,
  "max_retries": 3,
  "max_delay_ms": 60000,
  "provider_id": "f822eb4a-1234-5678-9abc-def012345678"
}
```

### Error Response (404)

```json
{
  "error": "Retry rule not found"
}
```

## POST /admin/api/retry-rules

Creates a new retry rule. Both `provider_id` and `body_matchers` are optional.

### Request Body

```json
{
  "name": "KIMI 429 速率限制",
  "status_code": 429,
  "body_pattern": "\"error\".*\"type\"\\s*:\\s*\"rate_limit_error\"",
  "body_matchers": "[{\"path\":\"error.type\",\"operator\":\"contains\",\"value\":\"rate_limit_error\"}]",
  "retry_strategy": "exponential",
  "retry_delay_ms": 5000,
  "max_retries": 3,
  "max_delay_ms": 60000,
  "is_active": 1,
  "provider_id": "f822eb4a-1234-5678-9abc-def012345678"
}
```

### Request Schema

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | ✅ | — | Rule display name (min 1 char) |
| `status_code` | `number` | ✅ | — | HTTP status code (100-599) |
| `body_pattern` | `string` | ✅ | — | Body regex pattern (must be valid regex) |
| `body_matchers` | `string \| null` | ❌ | `null` | JSON array of BodyMatcher objects. See BodyMatcher Schema below. When set, takes priority over body_pattern |
| `retry_strategy` | `"fixed" \| "exponential"` | ❌ | `"exponential"` | Retry strategy |
| `retry_delay_ms` | `number` | ❌ | `5000` | Base retry delay in ms (min 100) |
| `max_retries` | `number` | ❌ | `10` | Max retry attempts (0-100) |
| `max_delay_ms` | `number` | ❌ | `60000` | Max delay cap in ms (min 100) |
| `is_active` | `number` | ❌ | `1` | 0 = inactive, 1 = active |
| `provider_id` | `string \| null` | ❌ | `null` | Provider UUID to bind this rule to. `null` = global rule |

### BodyMatcher Schema

Each element in the `body_matchers` JSON array:

```json
{
  "path": "error.type",
  "operator": "contains",
  "value": "rate_limit_error"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | ✅ | Dot-separated JSON path (e.g. `"error.type"`, `"error.message"`) |
| `operator` | `"equals" \| "contains" \| "exists"` | ✅ | Comparison operator. `exists` ignores `value` |
| `value` | `string` | ❌ | Expected value. Required for `equals` and `contains`. Ignored for `exists` |

### Validation Errors (400)

| Condition | Response |
|-----------|----------|
| Invalid `body_pattern` regex | `{ "code": "INVALID_REGEX", "message": "Invalid body_pattern regex" }` |
| `body_matchers` not valid JSON | `{ "code": "VALIDATION_FAILED", "message": "body_matchers must be valid JSON" }` |
| `body_matchers` not an array | `{ "code": "VALIDATION_FAILED", "message": "body_matchers must be a JSON array" }` |
| Missing `path` in matcher item | `{ "code": "VALIDATION_FAILED", "message": "body_matcher.path is required and must be a string" }` |
| Invalid `operator` | `{ "code": "VALIDATION_FAILED", "message": "body_matcher.operator must be equals, contains, or exists" }` |
| Missing `value` for equals/contains | `{ "code": "VALIDATION_FAILED", "message": "body_matcher.value is required for equals/contains operators" }` |
| Schema validation failure | Fastify standard 400 with details |

### Success Response (201)

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

## PUT /admin/api/retry-rules/:id

Updates an existing retry rule. Only whitelist fields accepted. All fields optional.

### Request Body

```json
{
  "body_matchers": "[{\"path\":\"error.type\",\"operator\":\"contains\",\"value\":\"rate_limit_error\"}]",
  "provider_id": "f822eb4a-1234-5678-9abc-def012345678"
}
```

### Whitelist Fields (accepts these keys only)

```
name, status_code, body_pattern, is_active, retry_strategy, 
retry_delay_ms, max_retries, max_delay_ms, provider_id, body_matchers
```

Any fields outside this whitelist are silently ignored (per `buildUpdateQuery` behavior).

### To Bind to a Provider

```json
{
  "provider_id": "f822eb4a-1234-5678-9abc-def012345678"
}
```

### To Change from Bound to Global

```json
{
  "provider_id": null
}
```

### To Switch from body_pattern to body_matchers

```json
{
  "body_matchers": "[{\"path\":\"error.type\",\"operator\":\"contains\",\"value\":\"rate_limit_error\"}]",
  "body_pattern": ""
}
```

> Note: When `body_matchers` is set, the matching engine uses it first; `body_pattern` becomes the fallback (used only if body_matchers is null or JSON parse fails). Setting `body_pattern` to `""` is safe because empty-string body_pattern results in `pattern = null` (no regex fallback).

### To Clear body_matchers (revert to body_pattern)

```json
{
  "body_matchers": null
}
```

### Success Response (200)

```json
{
  "success": true
}
```

### Error Response (400)

Same validation errors as POST.

## DELETE /admin/api/retry-rules/:id

### Success Response (200)

```json
{
  "success": true
}
```

### Error Response (404)

```json
{
  "error": "Retry rule not found"
}
```

## POST /admin/api/retry-rules/ai-generate

No changes to this endpoint. The AI-generated rule does not include `provider_id` — the user must manually set it in the frontend after generation.

## StateRegistry Refresh

All mutating operations (POST, PUT, DELETE) call `stateRegistry.refreshRetryRules()` after the DB operation. This triggers `RetryRuleMatcher.load()` to rebuild the two-level cache from scratch. The cache refresh is synchronous (reload on the same DB connection).

## Backward Compatibility

- **Existing rules**: `provider_id = null`, `body_matchers = null` — behavior unchanged
- **Existing API clients**: Not sending `provider_id`/`body_matchers` → defaults to `null`
- **Existing frontend**: Shows existing rules without Provider column (null = "通用") and body_matchers column (null = show body_pattern). The frontend update adds these columns.

## Error Types Reference

### Matching Engine Behavior

| body_matchers value | body_pattern value | Matching behavior |
|--------------------|-------------------|-------------------|
| `null` | Valid regex | Regex match (existing behavior) |
| `null` | `""` (empty) | No match (pattern = null) |
| `null` | `null` | No match |
| Valid JSON array | Any | BodyMatchers AND match. If body_matchers returns false, regex fallback. |
| Invalid JSON | Any | BodyMatchers returns false (JSON parse fail), fallback to regex. |
| `[]` (empty array) | Any | BodyMatchers returns true (no conditions = match all), skips regex. |

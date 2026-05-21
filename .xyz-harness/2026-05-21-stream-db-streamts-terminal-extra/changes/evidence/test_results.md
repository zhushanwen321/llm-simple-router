---
verdict: pass
all_passing: true
---

# Test Results — stream-db-streamts-terminal-extra

## Backend Tests

```
cd router && npm test

 ✓ tests/diagnostic-fields.test.ts (11 tests) 17243ms
 Test Files  124 passed (124)
      Tests  1485 passed (1485)
   Duration  22.94s
```

**All 124 backend test files passed (1485 tests).**

### New Tests (11)

| Test | Scenario | Field Verified |
|------|----------|---------------|
| TC1 | Non-stream 200 | transport_kind = "success" |
| TC2 | Stream SSE 200 | transport_kind = "stream_success" |
| TC3 | Upstream 500 | transport_kind = "error" |
| TC4 | ECONNREFUSED | transport_kind = "throw" |
| TC5 | Stream idle timeout | abort_reason = "idle_timeout" |
| TC6 | Normal success | abort_reason IS NULL |
| TC7 | Connection refused | error_code = network error |
| TC8 | Normal success | error_code IS NULL |
| TC9 | Normal request | mapping_reason non-null |
| TC10 | Success no retry | resilience_action/reason |
| TC11 | Normal request | headers_sent IS NULL |

## Frontend Type Check

```
cd frontend && npx vue-tsc -b --noEmit
```

**0 errors.**

## Frontend Lint

```
cd frontend && npx eslint . --max-warnings=0
```

**0 warnings, 0 errors.**

## Backend Build

```
cd router && npx tsc --noEmit
```

**0 errors.**

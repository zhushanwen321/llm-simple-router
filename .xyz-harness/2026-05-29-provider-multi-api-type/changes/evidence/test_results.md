---
verdict: pass
all_passing: true
---

# Test Results — provider-multi-api-type

## Backend Tests
```
cd router && npx vitest run
Test Files  140 passed (140)
Tests  1730 passed | 5 skipped (1735)
Duration  22.87s
```

**All 140 backend test files passed (1730 tests, 5 skipped).**

## Frontend Build
```
cd frontend && npm run build
✓ built in 940ms
```

**Frontend build passed.**

## Backend Lint
```
cd router && npm run lint
> eslint . --max-warnings=0
(zero warnings, zero errors)
```

**Backend lint passed.**

## Frontend Type Check
```
cd frontend && npx vue-tsc -b --noEmit
(no errors)
```

**Frontend type check passed.**

## Frontend Lint
```
cd frontend && npx eslint . --max-warnings=0
(zero warnings, zero errors)
```

**Frontend lint passed.**

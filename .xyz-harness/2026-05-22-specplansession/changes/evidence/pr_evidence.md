---
pr_created: true
pr_url: https://github.com/zhushanwen321/llm-simple-router/pull/165
pr_title: "feat: retry rule upgrade - provider isolation, JSON body matchers, upstream error logging"
branch: fix-usage-limit-return
---

# PR Evidence

PR #165 already exists and is open. Latest push includes failover-loop.ts MUST FIX resolution.

## Commits (main..HEAD)
- 4cdd645 fix: restore failover continue behavior on provider unavailable
- 01bb760 pr: rewrite overall retrospect with cross-phase references
- da7c369 pr: add PR/CI evidence and overall retrospect
- 809b84a fix: exclude test files from vue-tsc build to fix Docker CI
- 0c3d999 feat: retry rule upgrade - provider isolation, body matchers, error logging
- 8bf95cf feat: retry rule provider isolation + JSON body matchers + upstream error logs
- ab57d47 test: add integration tests for retry rule provider isolation + upstream error logs
- 0dabc72 test: add frontend vitest + AC6/AC7 component test

## Key Changes
- **body-matcher.ts**: Pure function JSON field matching (equals/contains/exists)
- **retry-rules.ts**: RetryRuleMatcher upgraded to two-level cache (provider_id + status_code)
- **upstream-error-logs.ts**: New upstream error log DB layer
- **failover-loop.ts**: upstream_error_logs write + stream_error fix + provider unavailable continue
- **admin/retry-rules.ts**: CRUD adapted for provider_id + body_matchers
- **frontend RetryRules.vue**: Provider column + JSON matching editor
- **Migration 049**: provider_isolation_and_matchers.sql

## Test Coverage
- 1503 backend tests passing
- 43 unit tests (body-matcher, retry-rule-matcher, extract-error-info)
- 3 integration tests
- 11 admin API tests
- 2 frontend type validation tests

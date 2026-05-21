---
pr_created: true
pr_url: https://github.com/zhushanwen321/llm-simple-router/pull/161
pr_title: "feat: runtime diagnostic data persistence + model timeout UI fix"
branch: fix-stream-stop-reason
---

# PR Evidence

PR #161 created and pushed to remote.

## PR Details

- **Branch**: fix-stream-stop-reason → main
- **Commits**: 20 commits (including code review P1 fixes and robustness review P0 fix)
- **Changes**: 8 diagnostic columns on request_logs + ModelCard.vue UI fix + constants consolidation

## Key Files Changed

- `router/src/db/migrations/048_add_diagnostic_columns.sql` — new migration
- `router/src/core/types.ts` — new type fields (abortReason, error_code, headers_sent)
- `router/src/proxy/transport/stream.ts` — abort_reason, transport_kind extraction
- `router/src/proxy/orchestration/resilience.ts` — headers_sent, resilience_action/reason, finalDecision
- `router/src/proxy/handler/failover-loop.ts` — failover_trigger, mapping_reason, type-safe resilienceReason
- `router/src/proxy/proxy-logging.ts` — diagnosticFields per-attempt injection
- `router/src/proxy/log-helpers.ts` — rejected log diagnostic fields
- `router/src/db/logs.ts` — INSERT new columns
- `router/tests/diagnostic-fields.test.ts` — 13 integration tests
- `frontend/src/components/quick-setup/ModelCard.vue` — remove v-if, layout refactor
- `frontend/src/constants.ts` — shared DEFAULT_STREAM_TIMEOUT_MS
- `frontend/src/composables/useProviderForm.ts` — centralized constants, text capability guard
- `frontend/src/composables/useQuickSetup.ts` — centralized constants

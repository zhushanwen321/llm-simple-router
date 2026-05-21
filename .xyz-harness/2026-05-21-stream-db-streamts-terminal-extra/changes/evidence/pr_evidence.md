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
- **Commits**: 14 commits
- **Changes**: 8 diagnostic columns on request_logs + ModelCard.vue UI fix

## Key Files Changed

- `router/src/db/migrations/048_add_diagnostic_columns.sql` — new migration
- `router/src/core/types.ts` — new type fields (abortReason, error_code, headers_sent)
- `router/src/proxy/transport/stream.ts` — abort_reason, transport_kind extraction
- `router/src/proxy/transport/http.ts` — transport_kind for non-stream
- `router/src/proxy/orchestration/resilience.ts` — headers_sent, resilience_action/reason
- `router/src/proxy/handler/failover-loop.ts` — failover_trigger, mapping_reason
- `router/src/proxy/proxy-logging.ts` — new field extraction
- `router/src/proxy/log-helpers.ts` — new field extraction
- `router/src/db/logs.ts` — INSERT new columns
- `router/tests/diagnostic-fields.test.ts` — 13 new integration tests
- `frontend/src/components/quick-setup/ModelCard.vue` — remove v-if

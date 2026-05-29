---
verdict: pass
---

# E2E Test Plan — provider-multi-api-type

## Test Scenarios

### Scenario 1: DB Migration (AC-1, AC-5)
- Start with existing DB containing providers with old schema
- Run migration
- Verify endpoints column populated correctly
- Send OpenAI request to migrated provider → should work unchanged
- Restart server → migration should be idempotent (no re-processing)

### Scenario 2: Multi-Endpoint Exact Match (AC-2, AC-2b)
- Create provider with endpoints: [{openai, url-a}, {anthropic, url-b}]
- Send OpenAI request → should route to url-a, no transform
- Create provider with endpoints: [{openai}, {openai-responses}, {anthropic}]
- Send Responses API request → should route to openai-responses endpoint, no transform

### Scenario 3: Format Transform Fallback (AC-3, AC-3b)
- Create provider with only [{anthropic, url-b}]
- Send OpenAI request → should route to url-b with format transform
- Verify request_logs: api_type=openai, upstream_api_type=anthropic
- Create provider with only [{openai, url-a}]
- Send Responses API request → should transform openai-responses to openai

### Scenario 4: Endpoint API Key Encryption (AC-4)
- Create provider with endpoint api_key + shared api_key
- Read DB directly → endpoint api_key should be ciphertext
- Admin API GET → should return plaintext
- Send request to endpoint with own key → should use endpoint key
- Send request to endpoint without key → should use shared key

### Scenario 5: API Validation (AC-6)
- Create provider with duplicate api_type in endpoints → expect 400
- Create provider with empty endpoints → expect 400
- Create provider with missing base_url in endpoint → expect 400

### Scenario 6: Request Logging (AC-7)
- Create provider with anthropic endpoint, send openai request
- Check request_logs row: api_type=openai, upstream_api_type=anthropic, upstream_base_url recorded
- Send request with no transform → upstream_api_type = api_type

### Scenario 7: Provider CRUD + QuickSetup (AC-5, AC-9)
- Create provider via Admin API with 2 endpoints → success
- Update provider → add 3rd endpoint → success
- Delete provider → cleanup
- QuickSetup create provider → send request → success

### Scenario 8: Frontend Provider List (AC-8)
- Create provider with 3 endpoints
- Load provider list page
- Verify API Type column shows 3 badges
- Verify API Key column shows 3 rows with copy buttons

### Scenario 9: Upstream Path Override (AC-10)
- Create provider with custom upstream_path
- Send request → verify actual URL uses custom path

## Test Environment
- Node.js + Fastify test server with in-memory SQLite
- Mock backend servers (http.createServer) for each API type
- Frontend: Vitest + Vue Test Utils for component tests
- Integration: buildApp() with injected DB, app.inject() for HTTP requests

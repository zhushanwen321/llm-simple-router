# Per-Provider Network Proxy Support

GitHub Issue: zhushanwen321/llm-simple-router#66

## Background

Users in restricted network environments need SOCKS5 or HTTP proxy to access external model providers (e.g., Anthropic). Currently they must use system-level proxies or network tools. This feature adds per-provider proxy configuration to the router itself.

## Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Configuration granularity | Per-provider | Same proxy config may not apply to all providers; simple key-value on each provider |
| Credential storage | AES-256-GCM encrypted (same as API Key) | Passwords are sensitive |
| Routing strategy impact | Fully transparent | Proxy is a transport concern; retry/failover logic unchanged |
| Implementation pattern | ProxyAgentFactory singleton with agent cache | Connection reuse; clean separation; matches SemaphoreManager pattern |

## 1. Database Schema

Migration `041_add_provider_proxy.sql`:

```sql
ALTER TABLE providers ADD COLUMN proxy_type TEXT DEFAULT NULL;  -- NULL | 'http' | 'socks5'
ALTER TABLE providers ADD COLUMN proxy_url TEXT DEFAULT NULL;    -- e.g. 'socks5://127.0.0.1:1080'
ALTER TABLE providers ADD COLUMN proxy_username TEXT DEFAULT NULL;  -- AES encrypted
ALTER TABLE providers ADD COLUMN proxy_password TEXT DEFAULT NULL;  -- AES encrypted
```

- `proxy_type = NULL` means no proxy (default).
- `proxy_username` and `proxy_password` are AES-256-GCM encrypted using existing `encrypt()`/`decrypt()`.
- `proxy_url` is stored in plaintext (not sensitive, needed for admin display).

## 2. ProxyAgentFactory Module

New file: `router/src/proxy/transport/proxy-agent.ts`

### Data Structure

```ts
agentCache: Map<string, { agent: http.Agent; proxyUrl: string }>
```

### API

| Method | Signature | Behavior |
|--------|-----------|----------|
| `getAgent` | `(provider: { id, proxy_type, proxy_url, proxy_username, proxy_password }) => http.Agent \| undefined` | Cache hit → return existing agent. Cache miss → create new agent, cache, return. `proxy_type` falsy → return `undefined`. |
| `invalidate` | `(providerId: string) => void` | Destroy old agent (`agent.destroy()`), remove from cache. |

### Agent Creation

- `proxy_type === "http"` → `new HttpProxyAgent(proxyUrl, { auth })`
- `proxy_type === "socks5"` → `new SocksProxyAgent(proxyUrl, { auth })`
- When `proxy_username`/`proxy_password` are non-empty, pass auth credentials.

### npm Dependencies

- `socks-proxy-agent` — SOCKS5 proxy support
- `https-proxy-agent` — HTTP CONNECT proxy support

### Lifecycle

- Exported as singleton via `ServiceContainer` lazy-load pattern.
- `invalidate()` called on provider update, delete, or disable.

## 3. Transport Layer Changes

### `router/src/proxy/transport/http.ts`

`createUpstreamRequest` gains an optional `agent` parameter:

```ts
createUpstreamRequest(url: URL, options: UpstreamRequestOptions, agent?: http.Agent): http.ClientRequest
```

When `agent` is provided, it is passed as `options.agent` to `http.request()` / `https.request()`.

`callNonStream` and `callGet` gain an optional `agent` parameter, forwarded to `createUpstreamRequest`.

### `router/src/proxy/transport/stream.ts`

`callStream` gains an optional `agent` parameter, forwarded to `createUpstreamRequest`.

### `router/src/proxy/transport/transport-fn.ts`

`buildTransportFn` calls `proxyAgentFactory.getAgent(provider)` and passes the result to `callStream` / `callNonStream`.

### Call Chain

```
transport-fn.ts
  proxyAgentFactory.getAgent(provider) → agent | undefined
  → callStream(..., agent) / callNonStream(..., agent)
    → createUpstreamRequest(url, options, agent)
      → agent ? http.request({...options, agent}) : http.request(options)
```

`UpstreamRequestOptions` type is **not** modified — `agent` is a separate parameter, keeping `buildRequestOptions` unchanged.

## 4. DB Layer + Admin API

### `router/src/db/providers.ts`

- `Provider` interface: add `proxy_type`, `proxy_url`, `proxy_username`, `proxy_password`.
- `PROVIDER_FIELDS` whitelist: add all 4 fields.
- `createProvider`: encrypt `proxy_username` and `proxy_password` before insert.
- `updateProvider`: type already accepts partial fields; encryption handled in admin layer.

### `router/src/admin/providers.ts`

**TypeBox Schema** (`CreateProviderSchema` / `UpdateProviderSchema`):

```ts
proxy_type: Type.Optional(Type.Union([Type.Literal("http"), Type.Literal("socks5")])),
proxy_url: Type.Optional(Type.String({ minLength: 1 })),
proxy_username: Type.Optional(Type.String()),
proxy_password: Type.Optional(Type.String()),
```

**Validation**: when `proxy_type` is non-null, `proxy_url` is required (400 if missing).

**GET `/admin/api/providers`**: decrypt `proxy_username` / `proxy_password` before returning.

**POST `/admin/api/providers`**:
- Encrypt `proxy_username` / `proxy_password` before `createProvider()`.
- When `proxy_type` is null/empty, clear all proxy fields (prevent stale data).

**PUT `/admin/api/providers/:id`**:
- Encrypt proxy credentials if provided.
- When `proxy_type` is set to null, clear all proxy fields.
- After successful update, call `proxyAgentFactory.invalidate(id)`.

**DELETE `/admin/api/providers/:id`**:
- Call `proxyAgentFactory.invalidate(id)` to clean up cached agent.

## 5. Frontend

### `frontend/src/views/Providers.vue`

New collapsible section in the Provider edit dialog, placed after "Upstream Path" and before "Available Models":

```
┌─────────────────────────────────────┐
│ Proxy Configuration              ▼  │  ← Collapsible
│                                     │
│ Proxy Type  [No Proxy ▼]            │  ← Select: No Proxy / HTTP / SOCKS5
│ Proxy URL   [socks5://127.0.0.1:1080] │  ← Input, shown when type selected
│ Username    [optional]              │  ← Input, shown when type selected
│ Password    [optional]              │  ← Input type=password, shown when type selected
└─────────────────────────────────────┘
```

**Behavior**:
- "No Proxy" selected → hide URL/username/password fields, submit clears proxy fields.
- HTTP/SOCKS5 selected → show URL (required), username/password (optional).
- Proxy URL placeholder changes based on type: HTTP → `http://127.0.0.1:7890`, SOCKS5 → `socks5://127.0.0.1:1080`.

### Provider List Table

Add a proxy indicator icon (lucide `Shield` or `Globe`) next to the Base URL column cell. Hover tooltip shows proxy type. No extra column needed.

### Type Changes

- `frontend/src/api/client.ts` → `ProviderPayload` adds optional proxy fields.
- `frontend/src/types/mapping.ts` → `Provider` type adds proxy fields.

## 6. Error Handling + Testing

### Error Handling

- Proxy connection errors (`ECONNREFUSED`, `ETIMEDOUT`, auth failure) flow through existing `TransportResult.kind === "throw"` path.
- Resilience layer is fully transparent to proxy vs direct errors.
- Admin API validates: `proxy_type` non-null requires `proxy_url` (returns 400).

### Testing

| Type | Coverage |
|------|----------|
| Unit | `ProxyAgentFactory`: create/cache/invalidate; returns `undefined` when `proxy_type` is null |
| Unit | Admin API: proxy field encrypt/decrypt; 400 when `proxy_type` set without `proxy_url` |
| Integration | Mock SOCKS5/HTTP proxy server → Provider with proxy config → Request routed through proxy to mock backend |

No changes to existing tests — proxy is optional, behavior unchanged when not configured.

## Files Changed (Summary)

| File | Change |
|------|--------|
| `router/src/db/migrations/041_add_provider_proxy.sql` | **NEW** — 4 columns on providers |
| `router/src/proxy/transport/proxy-agent.ts` | **NEW** — ProxyAgentFactory singleton |
| `router/src/proxy/transport/http.ts` | `createUpstreamRequest` + `callNonStream` + `callGet` gain optional `agent` param |
| `router/src/proxy/transport/stream.ts` | `callStream` gains optional `agent` param |
| `router/src/proxy/transport/transport-fn.ts` | Get agent from factory, pass to transport functions |
| `router/src/db/providers.ts` | Interface + CRUD + whitelist add proxy fields |
| `router/src/admin/providers.ts` | Schema + encrypt/decrypt + invalidate cache |
| `frontend/src/views/Providers.vue` | Proxy config section in dialog |
| `frontend/src/api/client.ts` | `ProviderPayload` add proxy fields |
| `frontend/src/types/mapping.ts` | `Provider` add proxy fields |

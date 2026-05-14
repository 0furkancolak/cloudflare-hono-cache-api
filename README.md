# Cloudflare Hono Cache API

[Turkce README](./README.tr.md)

If you only want the cache layer in your own project, copy these files first:

```txt
src/middleware/route-cache.ts
src/cache/cache-key.ts
src/cache/invalidate.ts
src/cache/purge.ts
src/cache/tags.ts
```

Do not copy the bundled example store into production as-is. It exists only to keep this repository self-contained for demos and tests.

This repository is no longer a simple route-cache demo. It is intended to be a production-oriented reference for `Hono + Cloudflare Workers` with:

- JWT/JWKS-based authentication
- tenant isolation
- explicit public/private/bypass cache policies
- Cloudflare-native purge compatibility
- local smoke, load, performance, and stress verification

## Architecture Summary

## Redis vs Cloudflare Cache API

| Topic | Cloudflare Cache API | Redis |
| --- | --- | --- |
| Primary use | HTTP response caching at the edge | Application data cache / shared state |
| Best fit | Full route or response caching | Object/query/session caching |
| Geographic behavior | Closest edge/location cache | Depends on where Redis is deployed |
| Cache key model | Request/response oriented | Arbitrary string key/value |
| Invalidation | Purge by file/tag, HTTP-aware | Delete keys manually or by pattern |
| Auth-sensitive responses | Possible, but must be carefully tenant-scoped | Safer for per-user/per-tenant data shaping |
| Shared consistency | Not a shared global datastore | Central/shared cache datastore |
| Latency profile | Very fast on cache hit at edge | Fast, but still network hop to Redis |
| Stale-while-revalidate | Natural fit for public HTTP caching | Must be implemented in application logic |
| Good default here | Public response cache, selective tenant-safe route cache | Backing store for counters, sessions, shared metadata, registry |

Short rule of thumb:

- Use Cloudflare Cache API when you want to cache HTTP responses close to the user.
- Use Redis when you need shared mutable cache/state across regions or workers.
- Use both together when edge response caching is useful, but invalidation metadata or application state must stay centralized.

### Public cache

- `GET /products/:id`
- Suitable for edge caching
- Uses `Cache-Control: public, s-maxage=...`
- Produces deterministic cache keys
- Adds `Cache-Tag` values such as `products` and `product:<id>`
- `stale-while-revalidate` is meaningful here because CDN/browser layers can honor it

### Private allowlist cache

- `GET /accounts/:accountId/profile`
- Requires authentication
- The default resolver can derive tenant identity from claims such as `account_id`, `tenant_id`, `org_id`, or `workspace_id`
- `x-account-id` is only a helper signal; if it does not match the resolved tenant, the request is rejected
- Private cache keys use derived identity like `tenant:<id>` instead of raw `Authorization` values
- Worker-managed private cache currently behaves as TTL cache only; `stale-while-revalidate` is not promised for `caches.default`

### Critical data

- `GET /accounts/:accountId/balance`
- Always `BYPASS`
- Uses `Cache-Control: no-store`

### Purge

- Mutation routes generate exact cache-key and tag purge targets
- In production, if `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` are provided, the Cloudflare purge API is used
- In local/test mode, exact file purges are simulated through `caches.default`
- Tag-only purge is not supported in simulate mode; it hard-fails or soft-fails truthfully depending on `requireSuccessfulPurge`
- The old in-memory tag registry is gone

## Authentication

JWT verification enforces `JWKS + iss + aud + exp + nbf`.

Required environment variables:

```txt
JWT_JWKS_URL
JWT_ISSUER
JWT_AUDIENCE
```

Recommended optional variables:

```txt
AUTH_PROVIDER
AUTH_TENANT_CLAIM
AUTH_SCOPE_CLAIM
AUTH_ROLES_CLAIM
CACHE_KEY_VERSION
PRIVATE_CACHE_ENCRYPTION_KEY
ENVIRONMENT
LOG_LEVEL
DEBUG_CACHE_HEADERS
JWKS_CACHE_TTL_SECONDS
CLOUDFLARE_ZONE_ID
CLOUDFLARE_API_TOKEN
PURGE_HMAC_SECRET
CORS_ALLOW_ORIGINS
```

Examples:

```txt
# Supabase
AUTH_PROVIDER=supabase
AUTH_TENANT_CLAIM=org_id

# Better Auth or a custom gateway
AUTH_PROVIDER=better-auth
AUTH_TENANT_CLAIM=workspace_id
AUTH_SCOPE_CLAIM=permissions
AUTH_ROLES_CLAIM=roles
```

Current limitation:

- The bundled verifier supports `RS256` only

## Local Development

Install:

```txt
bun install
```

Run:

```txt
bun run dev
```

The default local port is `3497`.

This repository includes a development JWKS and private key only for local testing and smoke flows. They must not be used in production.

Generate a dev token:

```txt
ACCOUNT_ID=acc-1 bun run dev:token
```

## Smoke Test

With the worker running:

```txt
bun run smoke
```

This script verifies:

- public route `MISS -> HIT`
- private allowlist route `MISS -> HIT`
- critical route `BYPASS`
- mutation followed by purge and a fresh `MISS`
- HMAC-protected admin purge endpoint

## Load Test

Basic benchmark:

```txt
bun run load
```

Optional variables:

```txt
BASE_URL=http://127.0.0.1:3497
CONCURRENCY=16
DURATION_SECONDS=10
ACCOUNT_ID=acc-1
```

## Tests

Run the full suite:

```txt
bun test
```

Current coverage includes:

- query normalization
- public/private cache key isolation
- JWT claim extraction and audience validation
- public `MISS -> HIT`
- private auth enforcement
- tenant mismatch rejection
- purge after mutation
- JWKS refresh on key rotation
- critical route `BYPASS`
- admin purge auth failure
- hard and soft failure behavior for simulate-mode tag purge
- request-id sanitization
- CORS behavior across non-production and production-style bindings
- tenant isolation under mixed traffic and mutation churn

Performance regression test:

```txt
bun run test:perf
```

This runs the app in-process with warmed cache and verifies a loose `p95` budget for public/private cache hits. It is a regression alarm, not a capacity benchmark.

Heavier mixed-traffic stress test:

```txt
bun run test:stress
```

This runs two tenants under warmed cache, repeated reads, and mutation churn, and verifies that one tenant's mutation never leaks into another tenant's cached data.

## Reusable vs Example-only Files

Reusable:

```txt
src/cache/cache-key.ts
src/cache/invalidate.ts
src/cache/purge.ts
src/cache/tags.ts
src/middleware/route-cache.ts
```

Example-only:

```txt
src/store/example-store.ts
src/dev/jwks.ts
scripts/generate-dev-jwt.ts
scripts/generate-admin-signature.ts
scripts/smoke-cache.sh
scripts/load-test.ts
```

## Route Summary

```txt
GET  /products/:id
POST /products/:id
GET  /accounts/:accountId/profile
POST /accounts/:accountId/profile
GET  /accounts/:accountId/balance
POST /admin/cache/purge
GET  /admin/health
GET  /.well-known/jwks.json   # non-production only
```

## Operational Notes

- `X-Cache-Status` and `X-Cache-Policy` are preserved
- `DEBUG_CACHE_HEADERS` is off by default; enable it explicitly to receive `X-Cache-Key`
- Request IDs are sanitized before being echoed/logged
- CORS is open in non-production and allowlist-driven in production via `CORS_ALLOW_ORIGINS`
- Request, metric, and purge audit events are structured logs
- Full native purge behavior should not be expected in production unless Cloudflare zone/token config is provided

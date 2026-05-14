# Cloudflare Hono Cache API

[English README](./README.md)

Kendi projenizde sadece cache katmanini kullanacaksaniz once su dosyalari kopyalayin:

```txt
src/middleware/route-cache.ts
src/cache/cache-key.ts
src/cache/invalidate.ts
src/cache/purge.ts
src/cache/tags.ts
```

Bundled example store'u production'a oldugu gibi tasimayin. Bu dosya yalniz repo demo ve test akislari kendi kendine calissin diye vardir.

Bu repo artik basit bir route-cache demosu degil. Hedefi, `Hono + Cloudflare Workers` uzerinde:

- JWT/JWKS ile dogrulanan
- tenant izolasyonu korunan
- public/private/bypass cache politikasi acik tanimlanan
- Cloudflare native purge akisina uyumlu
- localde smoke, load, performance ve stress dogrulamalari kosulabilen

bir production referansi sunmak.

## Mimari Ozeti

## Redis vs Cloudflare Cache API

| Konu | Cloudflare Cache API | Redis |
| --- | --- | --- |
| Temel kullanim | Edge uzerinde HTTP response cache | Uygulama veri cache'i / paylasilan state |
| En uygun senaryo | Tam route veya response cache | Obje/query/session cache |
| Cografi davranis | Kullaniciya en yakin edge lokasyonda calisir | Redis'in kuruldugu bolgeye baglidir |
| Cache key modeli | Request/response odakli | Serbest string key/value |
| Invalidation | File/tag purge, HTTP semantiklerine uygun | Key silme veya pattern bazli temizleme |
| Auth hassas veri | Mumkun, ama tenant scope cok dikkatli kurulmalidir | User/tenant bazli veri icin daha guvenli |
| Paylasilan tutarlilik | Global ortak datastore degildir | Merkezi/paylasilan cache datastore |
| Latency profili | Edge HIT durumunda cok hizli | Hizli ama yine de Redis'e network gidisi var |
| Stale-while-revalidate | Public HTTP cache icin dogal uyumlu | Uygulama mantiginda ayrica kurulmalidir |
| Bu repo icin iyi varsayilan | Public response cache, secili tenant-safe route cache | Counter, session, shared metadata, registry gibi paylasilan alanlar |

Kisa kural:

- Kullaniciya yakin HTTP response cache istiyorsaniz Cloudflare Cache API kullanin.
- Region/worker'lar arasinda paylasilan mutable cache veya state istiyorsaniz Redis kullanin.
- Edge response cache faydali ama invalidation metadata veya uygulama state'i merkezi kalmaliysa ikisini birlikte kullanin.

### Public cache

- `GET /products/:id`
- Edge cache icin uygundur
- `Cache-Control: public, s-maxage=...` kullanir
- Deterministik cache key uretir
- `Cache-Tag` olarak `products` ve `product:<id>` ekler
- `stale-while-revalidate` burada anlamlidir; CDN/browser katmani bunu uygulayabilir

### Private allowlist cache

- `GET /accounts/:accountId/profile`
- Auth zorunludur
- Varsayilan resolver tenant kimligini `account_id`, `tenant_id`, `org_id` veya `workspace_id` claimlerinden okuyabilir
- `x-account-id` yalniz yardimci sinyaldir; cozulmus tenant ile eslesmiyorsa istek reddedilir
- Private cache key, ham `Authorization` degeri yerine `tenant:<id>` kimligini kullanir
- Worker yonettigi private cache su an sadece TTL davranisi verir; `caches.default` icin otomatik `stale-while-revalidate` vaat edilmez

### Kritik veri

- `GET /accounts/:accountId/balance`
- Her zaman `BYPASS`
- `Cache-Control: no-store`

### Purge

- Mutation route'lari exact cache-key ve tag purge hedefleri uretir
- Production'da `CLOUDFLARE_API_TOKEN` ve `CLOUDFLARE_ZONE_ID` verilirse Cloudflare purge API kullanilir
- Local/test modunda exact file purge `caches.default` uzerinden simulate edilir
- Simulate modda tag-only purge desteklenmez; `requireSuccessfulPurge` degerine gore hard-fail veya truthy soft-fail doner
- Eski in-memory tag registry kaldirilmistir

## Kimlik Dogrulama

JWT dogrulamasi `JWKS + iss + aud + exp + nbf` kurallarini uygular.

Gerekli environment degiskenleri:

```txt
JWT_JWKS_URL
JWT_ISSUER
JWT_AUDIENCE
```

Onerilen opsiyonel degiskenler:

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

Ornekler:

```txt
# Supabase
AUTH_PROVIDER=supabase
AUTH_TENANT_CLAIM=org_id

# Better Auth veya custom gateway
AUTH_PROVIDER=better-auth
AUTH_TENANT_CLAIM=workspace_id
AUTH_SCOPE_CLAIM=permissions
AUTH_ROLES_CLAIM=roles
```

Mevcut kisit:

- Bundled verifier sadece `RS256` destekler

## Local Gelistirme

Kurulum:

```txt
bun install
```

Calistirma:

```txt
bun run dev
```

Varsayilan local port `3497`'dir.

Repo icinde local test ve smoke icin development JWKS ve private key bulunur. Bunlar production'da kullanilmamalidir.

Dev token uretmek:

```txt
ACCOUNT_ID=acc-1 bun run dev:token
```

## Smoke Test

Worker ayakta iken:

```txt
bun run smoke
```

Script su akislari dogrular:

- public route `MISS -> HIT`
- private allowlist route `MISS -> HIT`
- kritik route `BYPASS`
- mutation sonrasi purge ve yeni `MISS`
- HMAC korumali admin purge endpoint

## Load Test

Basit benchmark:

```txt
bun run load
```

Opsiyonel degiskenler:

```txt
BASE_URL=http://127.0.0.1:3497
CONCURRENCY=16
DURATION_SECONDS=10
ACCOUNT_ID=acc-1
```

## Testler

Tum testleri calistirmak icin:

```txt
bun test
```

Mevcut kapsam:

- query normalization
- public/private cache key izolasyonu
- JWT claim extraction ve audience validation
- public `MISS -> HIT`
- private auth enforcement
- tenant mismatch rejection
- mutation sonrasi purge
- JWKS rotation refresh
- kritik route `BYPASS`
- admin purge auth failure
- simulate-mode tag purge icin hard/soft fail davranisi
- request-id sanitization
- non-production ve production-benzeri binding'lerde CORS davranisi
- karma tenant trafigi ve mutation churn altinda izolasyon

Performans regresyon testi:

```txt
bun run test:perf
```

Bu test uygulamayi process icinde isitilmis cache ile calistirir ve public/private cache hit'leri icin gevsek bir `p95` butcesi dogrular. Kapasite testi degil, regresyon alarmidir.

Daha agir karma trafik stress testi:

```txt
bun run test:stress
```

Bu test iki tenant'i isitilmis cache, tekrarli okuma ve mutation churn altinda calistirir; bir tenant mutation'inin diger tenant cache/verisine sizmamasini dogrular.

## Yeniden Kullanilabilir vs Example-only Dosyalar

Yeniden kullanilabilir:

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

## Route Ozeti

```txt
GET  /products/:id
POST /products/:id
GET  /accounts/:accountId/profile
POST /accounts/:accountId/profile
GET  /accounts/:accountId/balance
POST /admin/cache/purge
GET  /admin/health
GET  /.well-known/jwks.json   # sadece non-production
```

## Operasyonel Notlar

- `X-Cache-Status` ve `X-Cache-Policy` korunur
- `DEBUG_CACHE_HEADERS` varsayilan olarak kapali; `X-Cache-Key` almak icin bilerek acin
- Request ID'ler echo/log oncesi sanitize edilir
- CORS non-production'da acik, production'da `CORS_ALLOW_ORIGINS` ile allowlist kontrolludur
- Request, metric ve purge audit olaylari structured log olarak yazilir
- Cloudflare zone/token config verilmeden production'da tam native purge davranisi beklenmemelidir

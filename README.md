# Hono + Cloudflare Route Cache (Workers Cache API)

Harici servis kullanmadan (`Redis/KV` yok), yalnızca `caches.default` ile middleware seviyesinde route cache yönetimi sağlar.

## Kurulum

```txt
bun install
```

## Geliştirme

```txt
bun run dev
```

Not: Local geliştirme portu `3497` olarak ayarlıdır.

## Deploy

```txt
bun run deploy
```

## Bindings Type Üretimi

```txt
bun run cf-typegen
```

## Cache Mimarisi

- `src/middleware/route-cache.ts`: Route bazında dinamik cache middleware
- `src/cache/cache-key.ts`: Deterministik cache key üretimi (path/query/vary header/cookie)
- `src/cache/invalidate.ts`: URL veya tag tabanlı invalidation helper'ları

Varsayılan middleware davranışı:

- Sadece `GET/HEAD` cachelenir
- `X-Cache-Status: HIT | MISS | BYPASS` başlığı döner
- `Cache-Control` yoksa otomatik `public, s-maxage=<ttl>, stale-while-revalidate=<swr>` eklenir
- `no-store/private` veya 4xx/5xx cevaplar cachelenmez

## Route Örnekleri

- `GET /products/:id`: Cachelenebilir örnek route
- `POST /products/:id/update`: Ürünü günceller ve ilgili cache'i invalidate eder
- `GET /me`: `Authorization` varsa cache bypass
- `POST /products/:id/refresh`: Internal helper ile ilgili ürün cache kaydını siler
- `POST /cache/invalidate`: Secret korumalı endpoint ile URL/tag invalidation

## Middleware Kullanımı

```ts
app.get(
  '/products/:id',
  routeCacheMiddleware({
    ttlSeconds: 120,
    staleWhileRevalidateSeconds: 60,
    includeQuery: true,
    varyHeaders: ['Accept-Language'],
    varyCookies: ['locale'],
    tags: (c) => [getProductTag(c.req.param('id') ?? ''), CACHE_TAG_KEYS.products],
  }),
  handler
)
```

## Invalidate Endpoint Kullanımı

Önce secret tanımla:

```txt
wrangler secret put CACHE_INVALIDATE_SECRET
```

Sonra endpoint çağır:

```txt
curl -X POST http://127.0.0.1:3497/cache/invalidate \
  -H "Content-Type: application/json" \
  -H "x-cache-secret: <SECRET>" \
  -d '{"urls":["/products/42"],"tags":["products","product:42"]}'
```

## Update Route Ornegi (Cache Invalidate)

```txt
curl -X POST http://127.0.0.1:3497/products/42/update \
  -H "Content-Type: application/json" \
  -d '{"name":"Product-42-Updated"}'
```

Bu endpoint:
- veriyi gunceller
- `/products/42` cache kaydini invalidate eder
- cache doldurma yapmaz; sonraki `GET /products/:id` istegi cache'i yeniden olusturur

## Önemli Notlar

- Workers Cache API anahtarları listelenemediği için wildcard/pattern purge doğrudan desteklenmez.
- Bu projede tag invalidation, worker isolate içindeki in-memory registry ile uygulanır.
- Çoklu instance/colo senaryolarında tam küresel invalidation için Cloudflare Cache Tags + zone purge API veya KV/D1 tabanlı registry gerekebilir.

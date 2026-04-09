import { Hono } from 'hono'
import type { Context } from 'hono'

import { invalidateByUrls, invalidateFromPayload } from './cache/invalidate'
import { CACHE_TAG_KEYS, getProductTag } from './cache/tags'
import { routeCacheMiddleware } from './middleware/route-cache'
import type { AppEnv, CacheInvalidatePayload } from './types/env'

const CACHE_SECRET_HEADER = 'x-cache-secret'
const DEFAULT_CACHE_INVALIDATE_SECRET = 'change-production'
const cacheKeyCommon = {
  includeQuery: true,
  varyHeaders: ['Accept-Language'],
  varyCookies: ['locale'],
}

const app = new Hono<AppEnv>()
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const productStore = new Map<string, { id: string; name: string; updatedAt: string }>()

function getRequiredParam(c: Context<AppEnv>, key: string): string | null {
  const value = c.req.param(key)
  if (!value) {
    return null
  }
  return value
}

function getOrCreateProduct(productId: string): { id: string; name: string; updatedAt: string } {
  const current = productStore.get(productId)
  if (current) {
    return current
  }

  const created = {
    id: productId,
    name: `Product-${productId}`,
    updatedAt: new Date().toISOString(),
  }
  productStore.set(productId, created)
  return created
}

app.get(
  '/products/:id',
  routeCacheMiddleware({
    ttlSeconds: 120,
    staleWhileRevalidateSeconds: 60,
    ...cacheKeyCommon,
    tags: (c) => {
      const productId = c.req.param('id')
      if (!productId) {
        return [CACHE_TAG_KEYS.products]
      }
      return [getProductTag(productId), CACHE_TAG_KEYS.products]
    },
  }),
  async (c) => {
    // Cache etkisini gostermek icin sadece MISS durumunda handler calisir.
    await wait(1000)

    const productId = getRequiredParam(c, 'id')
    if (!productId) {
      return c.json({ error: 'Missing product id' }, 400)
    }

    const product = getOrCreateProduct(productId)
    return c.json(product)
  }
)

app.get(
  '/me',
  routeCacheMiddleware({
    bypassWhen: (c) => Boolean(c.req.header('Authorization')),
  }),
  async (c) => {
    // Bu route cache bypass alabilecegi icin her istekte gecikme gorulebilir.
    await wait(1000)

    return c.json({
      message: 'Authorization header varsa cache bypass edilir.',
      cacheStatus: c.get('cacheStatus') ?? 'UNKNOWN',
    })
  }
)

app.post('/products/:id/refresh', async (c) => {
  const productId = getRequiredParam(c, 'id')
  if (!productId) {
    return c.json({ error: 'Missing product id' }, 400)
  }
  const targetPath = `/products/${productId}`
  const result = await invalidateByUrls(c, [targetPath], cacheKeyCommon)

  return c.json({
    ok: true,
    invalidatedPath: targetPath,
    result,
  })
})

app.post('/products/:id/update', async (c) => {
  const productId = getRequiredParam(c, 'id')
  if (!productId) {
    return c.json({ error: 'Missing product id' }, 400)
  }

  const body = await c.req.json<{ name?: string }>()
  const current = getOrCreateProduct(productId)
  const next = {
    ...current,
    name: body.name?.trim() || current.name,
    updatedAt: new Date().toISOString(),
  }
  productStore.set(productId, next)

  const targetPath = `/products/${productId}`
  const invalidateResult = await invalidateByUrls(c, [targetPath], cacheKeyCommon)

  return c.json({
    ok: true,
    product: next,
    invalidatedPath: targetPath,
    invalidateResult,
  })
})

app.post('/cache/invalidate', async (c) => {
  const secret = c.env.CACHE_INVALIDATE_SECRET ?? DEFAULT_CACHE_INVALIDATE_SECRET
  if (c.req.header(CACHE_SECRET_HEADER) !== secret) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const payload = await c.req.json<CacheInvalidatePayload>()
  const result = await invalidateFromPayload(c, payload, cacheKeyCommon)
  return c.json({
    ok: true,
    ...result,
  })
})

app.get('/', (c) => {
  return c.json({
    service: 'hono-cf-route-cache',
    routes: {
      cacheable: 'GET /products/:id',
      updateAndInvalidate: 'POST /products/:id/update',
      bypassSample: 'GET /me',
      internalInvalidate: 'POST /products/:id/refresh',
      endpointInvalidate: 'POST /cache/invalidate',
    },
  })
})

export default app

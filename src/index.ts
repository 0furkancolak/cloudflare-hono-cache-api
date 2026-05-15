import { Hono } from 'hono'
import type { Context } from 'hono'

import { buildRoutePurgePayload, getAbsoluteUrl, getKeyVersion, mergePurgePayloads } from './cache/invalidate'
import { purgeCache, getPurgeHmacSecret, verifyPurgeSignature } from './cache/purge'
import { CACHE_TAG_KEYS, getPhotosFeedTag, getProductTag, getProfileTag, getTenantTag } from './cache/tags'
import { DEV_JWKS } from './dev/jwks'
import { optionalAuth, requireAuth, requireScope } from './middleware/auth'
import { requestContextMiddleware } from './middleware/request-context'
import { routeCacheMiddleware } from './middleware/route-cache'
import { securityHeadersMiddleware } from './middleware/security-headers'
import type { AppEnv, AuthContext, CacheInvalidatePayload } from './types/env'
import { recordMetric } from './observability/metrics'
import { getOrCreateBalance, getOrCreateProduct, getOrCreateProfile, setProduct, setProfile } from './store/example-store'
import { fetchAndExpandPhotos } from './store/photos-feed'
import { cors } from 'hono/cors'

const cacheKeyCommon = {
  includeQuery: true,
  varyHeaders: ['Accept-Language'],
  varyCookies: ['locale']
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function isProduction(c: Context<AppEnv>): boolean {
  return (c.env.ENVIRONMENT ?? 'development').toLowerCase() === 'production'
}

function getRequiredParam(c: Context<AppEnv>, key: string): string | null {
  const value = c.req.param(key)
  return value || null
}

function resolveCorsOrigins(env: AppEnv['Bindings']): string[] | '*' {
  if ((env.ENVIRONMENT ?? 'development').toLowerCase() !== 'production') {
    return '*'
  }

  const configured = (env.CORS_ALLOW_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  return configured.length > 0 ? configured : []
}

function ensureTenantAccess(c: Context<AppEnv>, auth: AuthContext): Response | null {
  const accountId = getRequiredParam(c, 'accountId')
  if (!accountId) {
    return c.json({ error: 'Missing account id' }, 400)
  }
  if (accountId !== auth.tenantId) {
    return c.json({ error: 'Forbidden', message: 'Tenant mismatch' }, 403)
  }
  return null
}

async function purgeOrFail(c: Context<AppEnv>, payload: CacheInvalidatePayload, actor: AuthContext | null) {
  try {
    return await purgeCache(c, payload, {
      type: actor ? 'user' : 'service',
      subject: actor?.subject ?? 'admin-service',
      tenantId: actor?.tenantId
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cache purge failed'
    return c.json(
      {
        ok: false,
        error: 'PurgeFailed',
        message,
        writeCommitted: true
      },
      502
    )
  }
}

export function createApp(): Hono<AppEnv> {
  // Copy note:
  // In another project, keep `createApp()` as the composition root and swap only the domain routes/stores.
  // The reusable building blocks are auth, route-cache, purge, invalidate, tags, and observability modules.
  const app = new Hono<AppEnv>()

  app.use(
    '*',
    cors({
      origin: (origin, c) => {
        const allowed = resolveCorsOrigins(c.env)
        if (allowed === '*') {
          return origin || '*'
        }
        if (!origin) {
          return ''
        }
        return allowed.includes(origin) ? origin : ''
      },
      allowMethods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type', 'x-account-id', 'x-request-id', 'x-admin-signature', 'x-admin-timestamp'],
      exposeHeaders: ['X-Cache-Status', 'X-Cache-Policy', 'X-Request-Id'],
    })
  )
  app.use('*', requestContextMiddleware)
  app.use('*', securityHeadersMiddleware)

  app.get('/.well-known/jwks.json', (c) => {
    if (isProduction(c)) {
      return c.json({ error: 'Not Found' }, 404)
    }
    return c.json(DEV_JWKS)
  })

  app.get('/', (c) => {
    return c.json({
      service: 'hono-cf-route-cache',
      environment: c.env.ENVIRONMENT ?? 'development',
      cacheKeyVersion: c.env.CACHE_KEY_VERSION ?? 'v1',
      routes: {
        publicProduct: 'GET /products/:id',
        productMutation: 'POST /products/:id',
        privateProfile: 'GET /accounts/:accountId/profile',
        privatePhotosFeed: 'GET /accounts/:accountId/photos-feed',
        criticalBalance: 'GET /accounts/:accountId/balance',
        profileMutation: 'POST /accounts/:accountId/profile',
        adminPurge: 'POST /admin/cache/purge',
        adminHealth: 'GET /admin/health'
      }
    })
  })

  app.get(
    '/products/:id',
    routeCacheMiddleware({
      mode: 'public',
      ttlSeconds: 120,
      staleWhileRevalidateSeconds: 60,
      ...cacheKeyCommon,
      tags: (c) => {
        const productId = c.req.param('id')
        return productId ? [CACHE_TAG_KEYS.products, getProductTag(productId)] : [CACHE_TAG_KEYS.products]
      }
    }),
    async (c) => {
      await wait(250)
      const productId = getRequiredParam(c, 'id')
      if (!productId) {
        return c.json({ error: 'Missing product id' }, 400)
      }
      return c.json(getOrCreateProduct(productId))
    }
  )

  app.post('/products/:id', requireAuth, requireScope('products:write'), async (c) => {
    const productId = getRequiredParam(c, 'id')
    if (!productId) {
      return c.json({ error: 'Missing product id' }, 400)
    }

    const body = await c.req.json<{ name?: string }>()
    const current = getOrCreateProduct(productId)
    const next = {
      ...current,
      name: body.name?.trim() || current.name,
      updatedAt: new Date().toISOString()
    }
    setProduct(productId, next)

    const purgePayload = await buildRoutePurgePayload({
      absoluteUrl: getAbsoluteUrl(c.req.url, `/products/${productId}`),
      mode: 'public',
      version: getKeyVersion(c.env),
      ...cacheKeyCommon,
      tags: [CACHE_TAG_KEYS.products, getProductTag(productId)]
    })

    const purgeResult = await purgeOrFail(c, purgePayload, c.get('auth') ?? null)
    if (purgeResult instanceof Response) {
      return purgeResult
    }

    return c.json({
      ok: true,
      product: next,
      purgeResult
    })
  })

  app.get(
    '/accounts/:accountId/profile',
    requireAuth,
    routeCacheMiddleware({
      mode: 'private',
      ttlSeconds: 45,
      staleWhileRevalidateSeconds: 15,
      includeQuery: true,
      varyHeaders: [],
      varyCookies: [],
      tags: (c) => {
        const accountId = c.req.param('accountId') ?? ''
        return [CACHE_TAG_KEYS.profiles, getTenantTag(accountId), getProfileTag(accountId)]
      }
    }),
    async (c) => {
      const auth = c.get('auth')
      if (!auth) {
        recordMetric('auth.jwt.failure', 1, {}, c.env)
        return c.json({ error: 'Unauthorized' }, 401)
      }

      const denial = ensureTenantAccess(c, auth)
      if (denial) {
        return denial
      }

      await wait(250)
      return c.json(getOrCreateProfile(auth.tenantId))
    }
  )

  app.get(
    '/accounts/:accountId/photos-feed',
    requireAuth,
    routeCacheMiddleware({
      mode: 'private',
      ttlSeconds: 120,
      staleWhileRevalidateSeconds: 30,
      includeQuery: true,
      varyHeaders: [],
      varyCookies: [],
      tags: (c) => {
        const accountId = c.req.param('accountId') ?? ''
        return [CACHE_TAG_KEYS.photos, getTenantTag(accountId), getPhotosFeedTag(accountId)]
      }
    }),
    async (c) => {
      const auth = c.get('auth')
      if (!auth) {
        recordMetric('auth.jwt.failure', 1, {}, c.env)
        return c.json({ error: 'Unauthorized' }, 401)
      }

      const denial = ensureTenantAccess(c, auth)
      if (denial) {
        return denial
      }

      try {
        return c.json(await fetchAndExpandPhotos())
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Photos feed upstream failed'
        return c.json({ error: 'UpstreamFailed', message }, 502)
      }
    }
  )

  app.get(
    '/accounts/:accountId/balance',
    requireAuth,
    routeCacheMiddleware({
      mode: 'bypass'
    }),
    async (c) => {
      const auth = c.get('auth')
      if (!auth) {
        recordMetric('auth.jwt.failure', 1, {}, c.env)
        return c.json({ error: 'Unauthorized' }, 401)
      }

      const denial = ensureTenantAccess(c, auth)
      if (denial) {
        return denial
      }

      const balance = getOrCreateBalance(auth.tenantId)
      c.header('Cache-Control', 'no-store')
      return c.json(balance)
    }
  )

  app.post('/accounts/:accountId/profile', requireAuth, async (c) => {
    const auth = c.get('auth')
    if (!auth) {
      recordMetric('auth.jwt.failure', 1, {}, c.env)
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const denial = ensureTenantAccess(c, auth)
    if (denial) {
      return denial
    }

    const body = await c.req.json<{ displayName?: string }>()
    const current = getOrCreateProfile(auth.tenantId)
    const next = {
      ...current,
      displayName: body.displayName?.trim() || current.displayName,
      updatedAt: new Date().toISOString()
    }
    setProfile(auth.tenantId, next)

    const profilePurge = await buildRoutePurgePayload({
      absoluteUrl: getAbsoluteUrl(c.req.url, `/accounts/${auth.tenantId}/profile`),
      mode: 'private',
      version: getKeyVersion(c.env),
      auth,
      tags: [CACHE_TAG_KEYS.profiles, getTenantTag(auth.tenantId), getProfileTag(auth.tenantId)]
    })

    const purgeResult = await purgeOrFail(c, profilePurge, auth ?? null)
    if (purgeResult instanceof Response) {
      return purgeResult
    }

    return c.json({
      ok: true,
      profile: next,
      purgeResult
    })
  })

  app.post('/admin/cache/purge', async (c) => {
    const secret = getPurgeHmacSecret(c.env)
    const validSignature = await verifyPurgeSignature(c.req.raw, secret)
    if (!validSignature) {
      return c.json({ error: 'Unauthorized', message: 'Invalid admin signature' }, 401)
    }

    const payload = await c.req.json<CacheInvalidatePayload>()
    let result
    try {
      result = await purgeCache(
        c,
        {
          ...payload,
          requireSuccessfulPurge: payload.requireSuccessfulPurge ?? true
        },
        {
          type: 'service',
          subject: 'admin-cache-purge'
        }
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Admin purge failed'
      return c.json(
        {
          ok: false,
          error: 'PurgeFailed',
          message,
        },
        502
      )
    }

    return c.json({
      ok: true,
      result
    })
  })

  app.get('/admin/health', optionalAuth, async (c) => {
    if (isProduction(c)) {
      const auth = c.get('auth')
      if (!auth || (!auth.scopes.includes('admin:health:read') && !auth.roles.includes('admin'))) {
        return c.json({ error: 'Forbidden' }, 403)
      }
    }

    const profileProbe = await buildRoutePurgePayload({
      absoluteUrl: getAbsoluteUrl(c.req.url, '/accounts/health/profile'),
      mode: 'private',
      auth: {
        subject: 'health-probe',
        tenantId: 'health',
        scopes: [],
        roles: [],
        issuer: c.env.JWT_ISSUER,
        audience: [c.env.JWT_AUDIENCE],
        expiresAt: Math.floor(Date.now() / 1000) + 60
      },
      tags: [getTenantTag('health')],
      version: getKeyVersion(c.env)
    })

    const publicProbe = await buildRoutePurgePayload({
      absoluteUrl: getAbsoluteUrl(c.req.url, '/products/health'),
      mode: 'public',
      version: getKeyVersion(c.env),
      tags: [getProductTag('health')],
      ...cacheKeyCommon
    })

    return c.json({
      ok: true,
      environment: c.env.ENVIRONMENT ?? 'development',
      cacheKeyVersion: c.env.CACHE_KEY_VERSION ?? 'v1',
      purgeMode: c.env.CLOUDFLARE_ZONE_ID && c.env.CLOUDFLARE_API_TOKEN ? 'cloudflare' : 'simulate',
      probes: mergePurgePayloads(profileProbe, publicProbe)
    })
  })

  return app
}

const app = createApp()
export default app

// Copy note:
// This middleware is the portable entry point for route-level caching.
// When moving to another project, copy it together with:
// `src/cache/cache-key.ts`, `src/cache/tags.ts`, `src/observability/*`, auth middleware,
// and the env types that provide `CACHE_KEY_VERSION`, `DEBUG_CACHE_HEADERS`, and auth context.
import type { Context, MiddlewareHandler } from 'hono'
import type { AppEnv, CachePolicyMode, CacheStatus } from '../types/env'
import { buildCacheKeyUrl, type CacheKeyOptions } from '../cache/cache-key'
import { recordMetric } from '../observability/metrics'

type CacheTagResolver = (context: Context<AppEnv>) => string[] | Promise<string[]>

export interface RouteCacheOptions {
  mode: CachePolicyMode
  ttlSeconds?: number
  staleWhileRevalidateSeconds?: number
  methods?: string[]
  includeQuery?: boolean
  varyHeaders?: string[]
  varyCookies?: string[]
  keyPrefix?: string
  tags?: string[] | CacheTagResolver
}

const defaults = {
  ttlSeconds: 60,
  staleWhileRevalidateSeconds: 30,
  methods: ['GET', 'HEAD'],
  includeQuery: true,
  varyHeaders: [] as string[],
  varyCookies: [] as string[],
}

const CLIENT_CACHE_CONTROL_HEADER = 'X-Client-Cache-Control'

function setStatusHeaders(c: Context<AppEnv>, response: Response, status: CacheStatus): Response {
  const headers = new Headers(response.headers)
  const clientCacheControl = headers.get(CLIENT_CACHE_CONTROL_HEADER)
  if (clientCacheControl) {
    headers.set('Cache-Control', clientCacheControl)
    headers.delete(CLIENT_CACHE_CONTROL_HEADER)
  }

  headers.set('X-Cache-Status', status)
  headers.set('X-Cache-Policy', c.get('cachePolicy') ?? 'bypass')
  headers.set('X-Request-Id', c.get('requestId') ?? '')

  if (c.env.DEBUG_CACHE_HEADERS === 'true') {
    const keyUrl = c.get('cacheKeyUrl')
    if (keyUrl) {
      headers.set('X-Cache-Key', keyUrl)
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function isCacheableResponse(mode: CachePolicyMode, response: Response): boolean {
  if (response.status < 200 || response.status >= 400) {
    return false
  }

  const cacheControl = response.headers.get('Cache-Control')?.toLowerCase() ?? ''
  if (cacheControl.includes('no-store')) {
    return false
  }

  if (mode === 'public' && cacheControl.includes('private')) {
    return false
  }

  return true
}

async function resolveTags(context: Context<AppEnv>, tags?: RouteCacheOptions['tags']): Promise<string[]> {
  if (!tags) {
    return []
  }
  return Array.isArray(tags) ? tags : await tags(context)
}

function buildCacheControl(mode: CachePolicyMode, ttlSeconds: number, swrSeconds: number): string {
  if (mode === 'private') {
    return `private, max-age=${ttlSeconds}`
  }
  return `public, s-maxage=${ttlSeconds}, stale-while-revalidate=${swrSeconds}`
}

function buildStorageCacheControl(mode: CachePolicyMode, ttlSeconds: number, swrSeconds: number): string {
  if (mode === 'private') {
    return `max-age=${ttlSeconds}`
  }
  return buildCacheControl(mode, ttlSeconds, swrSeconds)
}

function buildKeyOptions(
  c: Context<AppEnv>,
  merged: {
    mode: CachePolicyMode
    includeQuery: boolean
    varyHeaders: string[]
    varyCookies: string[]
    keyPrefix?: string
  }
): CacheKeyOptions {
  const auth = c.get('auth')
  return {
    mode: merged.mode,
    includeQuery: merged.includeQuery,
    varyHeaders: merged.varyHeaders,
    varyCookies: merged.varyCookies,
    keyPrefix: merged.keyPrefix,
    version: c.env.CACHE_KEY_VERSION,
    identity: merged.mode === 'private' && auth ? [`tenant:${auth.tenantId}`] : [],
  }
}

function metricName(mode: CachePolicyMode, status: CacheStatus): Parameters<typeof recordMetric>[0] {
  if (status === 'BYPASS') {
    return 'cache.bypass'
  }
  if (mode === 'private') {
    return status === 'HIT' ? 'cache.private.hit' : 'cache.private.miss'
  }
  return status === 'HIT' ? 'cache.public.hit' : 'cache.public.miss'
}

export function routeCacheMiddleware(options: RouteCacheOptions): MiddlewareHandler<AppEnv> {
  const merged = {
    ...defaults,
    ...options,
  }
  const allowedMethods = new Set<string>(merged.methods.map((method) => method.toUpperCase()))

  return async (c, next) => {
    c.set('cachePolicy', merged.mode)

    const method = c.req.method.toUpperCase()
    if (merged.mode === 'bypass' || !allowedMethods.has(method)) {
      c.set('cacheStatus', 'BYPASS')
      recordMetric(metricName(merged.mode, 'BYPASS'), 1, {}, c.env)
      await next()
      c.res = setStatusHeaders(c, c.res, 'BYPASS')
      return
    }

    if (merged.mode === 'private' && !c.get('auth')) {
      c.set('cacheStatus', 'BYPASS')
      recordMetric(metricName(merged.mode, 'BYPASS'), 1, {}, c.env)
      await next()
      c.res = setStatusHeaders(c, c.res, 'BYPASS')
      return
    }

    const keyUrl = await buildCacheKeyUrl(c.req.raw, buildKeyOptions(c, merged))
    c.set('cacheKeyUrl', keyUrl)

    const cache = caches.default
    const cacheRequest = new Request(keyUrl, { method: 'GET' })
    const hit = await cache.match(cacheRequest)

    if (hit) {
      c.set('cacheStatus', 'HIT')
      recordMetric(metricName(merged.mode, 'HIT'), 1, {}, c.env)
      c.res = setStatusHeaders(c, hit, 'HIT')
      return
    }

    await next()

    c.set('cacheStatus', 'MISS')
    recordMetric(metricName(merged.mode, 'MISS'), 1, {}, c.env)
    if (!isCacheableResponse(merged.mode, c.res)) {
      c.res = setStatusHeaders(c, c.res, 'MISS')
      return
    }

    const headers = new Headers(c.res.headers)
    const clientCacheControl =
      headers.get('Cache-Control') ?? buildCacheControl(merged.mode, merged.ttlSeconds, merged.staleWhileRevalidateSeconds)
    headers.set(CLIENT_CACHE_CONTROL_HEADER, clientCacheControl)
    headers.set('Cache-Control', buildStorageCacheControl(merged.mode, merged.ttlSeconds, merged.staleWhileRevalidateSeconds))

    const tags = await resolveTags(c, merged.tags)
    if (tags.length > 0) {
      headers.set('Cache-Tag', tags.join(','))
    }

    const cachedResponse = new Response(c.res.body, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers,
    })

    await cache.put(cacheRequest, cachedResponse.clone())
    c.res = setStatusHeaders(c, cachedResponse, 'MISS')
  }
}

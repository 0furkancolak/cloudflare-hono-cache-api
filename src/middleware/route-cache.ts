import type { Context, MiddlewareHandler } from 'hono'

import { buildCacheKeyUrl } from '../cache/cache-key'
import type { AppEnv, CacheStatus } from '../types/env'

type CacheTagResolver = (context: Context<AppEnv>) => string[] | Promise<string[]>
type BypassResolver = (context: Context<AppEnv>) => boolean | Promise<boolean>

export interface RouteCacheOptions {
  ttlSeconds?: number
  staleWhileRevalidateSeconds?: number
  methods?: string[]
  includeQuery?: boolean
  varyHeaders?: string[]
  varyCookies?: string[]
  keyPrefix?: string
  tags?: string[] | CacheTagResolver
  bypassWhen?: BypassResolver
}

const defaultOptions: Required<
  Pick<
    RouteCacheOptions,
    | 'ttlSeconds'
    | 'staleWhileRevalidateSeconds'
    | 'methods'
    | 'includeQuery'
    | 'varyHeaders'
    | 'varyCookies'
  >
> = {
  ttlSeconds: 60,
  staleWhileRevalidateSeconds: 30,
  methods: ['GET', 'HEAD'],
  includeQuery: true,
  varyHeaders: [],
  varyCookies: [],
}

const tagKeyRegistry = new Map<string, Set<string>>()

function setStatusHeader(response: Response, status: CacheStatus): Response {
  const headers = new Headers(response.headers)
  headers.set('X-Cache-Status', status)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function buildCacheControl(ttlSeconds: number, staleWhileRevalidateSeconds: number): string {
  return `public, s-maxage=${ttlSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`
}

function isCacheableResponse(response: Response): boolean {
  if (response.status < 200 || response.status >= 400) {
    return false
  }
  const cacheControl = response.headers.get('Cache-Control')?.toLowerCase() ?? ''
  if (cacheControl.includes('no-store') || cacheControl.includes('private')) {
    return false
  }
  return true
}

async function resolveTags(context: Context<AppEnv>, tags?: RouteCacheOptions['tags']): Promise<string[]> {
  if (!tags) {
    return []
  }

  if (Array.isArray(tags)) {
    return tags
  }

  const resolved = await tags(context)
  return resolved
}

function addKeyToTags(keyUrl: string, tags: string[]): void {
  for (const tag of tags) {
    const normalizedTag = tag.trim()
    if (!normalizedTag) {
      continue
    }

    const set = tagKeyRegistry.get(normalizedTag) ?? new Set<string>()
    set.add(keyUrl)
    tagKeyRegistry.set(normalizedTag, set)
  }
}

export function getTagKeyRegistry(): ReadonlyMap<string, ReadonlySet<string>> {
  return tagKeyRegistry
}

export function routeCacheMiddleware(options: RouteCacheOptions = {}): MiddlewareHandler<AppEnv> {
  const merged = {
    ...defaultOptions,
    ...options,
  }
  const allowedMethods = new Set<string>(merged.methods.map((method) => method.toUpperCase()))

  return async (c, next) => {
    const reqMethod = c.req.method.toUpperCase()
    const shouldBypass =
      !allowedMethods.has(reqMethod) || (await (merged.bypassWhen?.(c) ?? Promise.resolve(false)))

    if (shouldBypass) {
      c.set('cacheStatus', 'BYPASS')
      await next()
      c.res = setStatusHeader(c.res, 'BYPASS')
      return
    }

    const keyUrl = await buildCacheKeyUrl(c.req.raw, {
      includeQuery: merged.includeQuery,
      varyHeaders: merged.varyHeaders,
      varyCookies: merged.varyCookies,
      keyPrefix: merged.keyPrefix,
    })

    const cache = caches.default
    const cacheRequest = new Request(keyUrl, { method: 'GET' })
    const cacheHit = await cache.match(cacheRequest)

    if (cacheHit) {
      c.set('cacheStatus', 'HIT')
      c.set('cacheKeyUrl', keyUrl)
      c.res = setStatusHeader(cacheHit, 'HIT')
      return
    }

    await next()
    c.set('cacheStatus', 'MISS')
    c.set('cacheKeyUrl', keyUrl)

    if (!isCacheableResponse(c.res)) {
      c.res = setStatusHeader(c.res, 'MISS')
      return
    }

    const headers = new Headers(c.res.headers)
    if (!headers.has('Cache-Control')) {
      headers.set('Cache-Control', buildCacheControl(merged.ttlSeconds, merged.staleWhileRevalidateSeconds))
    }
    headers.set('X-Cache-Status', 'MISS')

    const responseToCache = new Response(c.res.body, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers,
    })

    const tags = await resolveTags(c, merged.tags)
    addKeyToTags(keyUrl, tags)
    await cache.put(cacheRequest, responseToCache.clone())
    c.res = responseToCache
  }
}

import type { Context } from 'hono'

import { buildCacheKeyUrl } from './cache-key'
import { getTagKeyRegistry } from '../middleware/route-cache'
import type { AppEnv, CacheInvalidatePayload } from '../types/env'

export interface CacheKeyBuilderOptions {
  includeQuery?: boolean
  varyHeaders?: string[]
  varyCookies?: string[]
  keyPrefix?: string
}

function unique(items: string[]): string[] {
  return [...new Set(items)]
}

async function toCacheKeyUrl(
  context: Context<AppEnv>,
  url: string,
  options: CacheKeyBuilderOptions
): Promise<string> {
  const absoluteUrl = new URL(url, context.req.url)
  const request = new Request(absoluteUrl.toString(), {
    method: 'GET',
    headers: context.req.raw.headers,
  })

  return buildCacheKeyUrl(request, {
    includeQuery: options.includeQuery ?? true,
    varyHeaders: options.varyHeaders ?? [],
    varyCookies: options.varyCookies ?? [],
    keyPrefix: options.keyPrefix,
  })
}

export async function invalidateByUrls(
  context: Context<AppEnv>,
  urls: string[],
  options: CacheKeyBuilderOptions = {}
): Promise<{ deleted: string[]; notFound: string[] }> {
  const cache = caches.default
  const deleted: string[] = []
  const notFound: string[] = []

  for (const rawUrl of unique(urls)) {
    const keyUrl = await toCacheKeyUrl(context, rawUrl, options)
    const ok = await cache.delete(new Request(keyUrl, { method: 'GET' }))
    if (ok) {
      deleted.push(rawUrl)
      continue
    }
    notFound.push(rawUrl)
  }

  return { deleted, notFound }
}

export async function invalidateByTags(tags: string[]): Promise<{ deletedKeys: number; touchedTags: string[] }> {
  const cache = caches.default
  const registry = getTagKeyRegistry()
  let deletedKeys = 0
  const touchedTags: string[] = []

  for (const tag of unique(tags)) {
    const keys = registry.get(tag)
    if (!keys || keys.size === 0) {
      continue
    }

    touchedTags.push(tag)
    for (const keyUrl of keys) {
      const deleted = await cache.delete(new Request(keyUrl, { method: 'GET' }))
      if (deleted) {
        deletedKeys += 1
      }
    }
  }

  return { deletedKeys, touchedTags }
}

export async function invalidateFromPayload(
  context: Context<AppEnv>,
  payload: CacheInvalidatePayload,
  options: CacheKeyBuilderOptions = {}
): Promise<{
  urlResult: { deleted: string[]; notFound: string[] }
  tagResult: { deletedKeys: number; touchedTags: string[] }
}> {
  const urlResult = await invalidateByUrls(context, payload.urls ?? [], options)
  const tagResult = await invalidateByTags(payload.tags ?? [])
  return { urlResult, tagResult }
}

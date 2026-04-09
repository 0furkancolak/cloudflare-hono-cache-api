// Copy note:
// This file converts a route definition into exact purge targets.
// Keep it next to `cache-key.ts` and call it from mutation handlers so cache invalidation
// uses the same key derivation logic as cache reads.
import type { AppEnv, AuthContext, CacheInvalidatePayload } from '../types/env'
import { buildCacheKeyUrl } from './cache-key'

interface BuildRoutePurgeTargetOptions {
  absoluteUrl: string
  mode: 'public' | 'private'
  tags?: string[]
  includeQuery?: boolean
  varyHeaders?: string[]
  varyCookies?: string[]
  keyPrefix?: string
  auth?: AuthContext
  version?: string
}

export async function buildRoutePurgePayload(options: BuildRoutePurgeTargetOptions): Promise<CacheInvalidatePayload> {
  const request = new Request(options.absoluteUrl, { method: 'GET' })
  const cacheKey = await buildCacheKeyUrl(request, {
    mode: options.mode,
    includeQuery: options.includeQuery ?? true,
    varyHeaders: options.varyHeaders ?? [],
    varyCookies: options.varyCookies ?? [],
    keyPrefix: options.keyPrefix,
    version: options.version,
    identity: options.mode === 'private' && options.auth ? [`tenant:${options.auth.tenantId}`] : [],
  })

  return {
    files: [cacheKey],
    tags: options.tags ?? [],
  }
}

export function getAbsoluteUrl(originUrl: string, path: string): string {
  return new URL(path, originUrl).toString()
}

export function mergePurgePayloads(...payloads: CacheInvalidatePayload[]): CacheInvalidatePayload {
  const files = new Set<string>()
  const tags = new Set<string>()

  for (const payload of payloads) {
    for (const file of payload.files ?? []) {
      files.add(file)
    }
    for (const tag of payload.tags ?? []) {
      tags.add(tag)
    }
  }

  return {
    files: [...files],
    tags: [...tags],
  }
}

export function getKeyVersion(env: AppEnv['Bindings']): string | undefined {
  return env.CACHE_KEY_VERSION
}

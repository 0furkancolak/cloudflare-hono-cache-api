// Copy note:
// Reuse this file as-is when you need deterministic cache keys across routes, tests, and purge code.
// Private cache isolation depends on the `identity` array; feed tenant/user fingerprints there instead of raw auth headers.
import type { CachePolicyMode } from '../types/env'
import { sha256Hex } from '../lib/hash'

export interface CacheKeyOptions {
  mode: CachePolicyMode
  includeQuery: boolean
  varyHeaders: string[]
  varyCookies: string[]
  identity?: string[]
  keyPrefix?: string
  version?: string
}

const COOKIE_SEPARATOR = ';'

function parseCookieHeader(cookieHeader: string | null): Map<string, string> {
  if (!cookieHeader) {
    return new Map<string, string>()
  }

  const parsed = new Map<string, string>()
  const rawCookies = cookieHeader.split(COOKIE_SEPARATOR)
  for (const item of rawCookies) {
    const index = item.indexOf('=')
    if (index <= 0) {
      continue
    }
    parsed.set(item.slice(0, index).trim(), item.slice(index + 1).trim())
  }

  return parsed
}

export function normalizeQuery(url: URL): string {
  const entries = [...url.searchParams.entries()].sort(([aKey, aValue], [bKey, bValue]) => {
    if (aKey === bKey) {
      return aValue.localeCompare(bValue)
    }
    return aKey.localeCompare(bKey)
  })
  return new URLSearchParams(entries).toString()
}

export async function buildCacheKeyUrl(request: Request, options: CacheKeyOptions): Promise<string> {
  const url = new URL(request.url)
  const normalizedUrl = new URL(url.origin)
  normalizedUrl.pathname = url.pathname
  if (options.includeQuery) {
    normalizedUrl.search = normalizeQuery(url)
  }

  const headerPairs: string[] = []
  for (const headerName of options.varyHeaders) {
    headerPairs.push(`${headerName.toLowerCase()}=${request.headers.get(headerName) ?? ''}`)
  }

  const cookieMap = parseCookieHeader(request.headers.get('cookie'))
  const cookiePairs: string[] = []
  for (const cookieName of options.varyCookies) {
    cookiePairs.push(`${cookieName}=${cookieMap.get(cookieName) ?? ''}`)
  }

  const identityPairs = [...(options.identity ?? [])].sort()
  const version = options.version?.trim() || 'v1'
  const prefix = options.keyPrefix?.trim() ? `${options.keyPrefix}:` : ''
  const varyPayload = JSON.stringify({
    mode: options.mode,
    headers: headerPairs,
    cookies: cookiePairs,
    identity: identityPairs,
    version,
  })
  const varyHash = await sha256Hex(varyPayload)
  return `${normalizedUrl.toString()}${normalizedUrl.search ? '&' : '?'}__ck=${prefix}${version}:${varyHash}`
}

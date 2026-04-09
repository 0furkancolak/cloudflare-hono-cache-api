export interface CacheKeyOptions {
  includeQuery: boolean
  varyHeaders: string[]
  varyCookies: string[]
  keyPrefix?: string
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
    const key = item.slice(0, index).trim()
    const value = item.slice(index + 1).trim()
    parsed.set(key, value)
  }

  return parsed
}

function normalizeQuery(url: URL): string {
  const entries = [...url.searchParams.entries()].sort(([aKey, aValue], [bKey, bValue]) => {
    if (aKey === bKey) {
      return aValue.localeCompare(bValue)
    }
    return aKey.localeCompare(bKey)
  })

  const nextParams = new URLSearchParams(entries)
  return nextParams.toString()
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return hex
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

  const varyPayload = `${headerPairs.join('|')}::${cookiePairs.join('|')}`
  const varyHash = await sha256Hex(varyPayload)
  const prefix = options.keyPrefix?.trim() ? `${options.keyPrefix}:` : ''

  return `${normalizedUrl.toString()}${normalizedUrl.search ? '&' : '?'}__ck=${prefix}${varyHash}`
}

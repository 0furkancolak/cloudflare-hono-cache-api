import type { AppBindings } from '../../src/types/env'
import { createDevJwt } from '../../scripts/lib/dev-auth'
import { createAdminSignature } from '../../scripts/lib/dev-auth'
import { DEV_JWKS } from '../../src/dev/jwks'
import { MemoryCache } from './memory-cache'

export function createBindings(overrides: Partial<AppBindings> = {}): AppBindings {
  return {
    ENVIRONMENT: 'test',
    LOG_LEVEL: 'silent',
    AUTH_PROVIDER: 'jwt',
    JWT_JWKS_URL: 'https://issuer.example.test/.well-known/jwks.json',
    JWT_ISSUER: 'https://cache-api.local',
    JWT_AUDIENCE: 'cache-api',
    CACHE_KEY_VERSION: 'test-v1',
    DEBUG_CACHE_HEADERS: 'false',
    ...overrides,
  }
}

export function installMemoryCache(): MemoryCache {
  const cache = new MemoryCache()
  ;(globalThis as typeof globalThis & { caches: { default: MemoryCache } }).caches = {
    default: cache,
  }
  return cache
}

export function installJwksFetch(bindings: AppBindings, jwks: unknown = DEV_JWKS): () => void {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url === bindings.JWT_JWKS_URL) {
      return new Response(JSON.stringify(jwks), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }
    return originalFetch(input as RequestInfo, init)
  }) as typeof fetch

  return () => {
    globalThis.fetch = originalFetch
  }
}

export async function makeAuthHeader(accountId = 'acc-1', scope?: string): Promise<Record<string, string>> {
  const token = await createDevJwt({
    accountId,
    scope,
  })

  return {
    Authorization: `Bearer ${token}`,
    'x-account-id': accountId,
  }
}

export async function makeAdminHeaders(
  pathname: string,
  body: string,
  secret = 'development-only-change-me'
): Promise<Record<string, string>> {
  const { timestamp, signature } = await createAdminSignature('POST', pathname, body, secret)
  return {
    'Content-Type': 'application/json',
    'x-admin-timestamp': timestamp,
    'x-admin-signature': signature,
  }
}

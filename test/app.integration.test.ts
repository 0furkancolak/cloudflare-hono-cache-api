import { beforeEach, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { createApp } from '../src/index'
import { DEV_JWKS } from '../src/dev/jwks'
import { PRIVATE_CACHE_ENCRYPTION_HEADER } from '../src/cache/private-cache-crypto'
import { routeCacheMiddleware } from '../src/middleware/route-cache'
import type { AppEnv } from '../src/types/env'
import { createBindings, installJwksFetch, installMemoryCache, makeAdminHeaders, makeAuthHeader } from './helpers/test-env'

describe('application integration', () => {
  const app = createApp()

  beforeEach(() => {
    installMemoryCache()
  })

  it('serves public routes as MISS then HIT', async () => {
    const bindings = createBindings()
    const restoreFetch = installJwksFetch(bindings)

    const first = await app.fetch(new Request('https://app.test/products/42'), bindings)
    const second = await app.fetch(new Request('https://app.test/products/42'), bindings)

    expect(first.headers.get('X-Cache-Status')).toBe('MISS')
    expect(second.headers.get('X-Cache-Status')).toBe('HIT')
    expect(first.headers.get('X-Cache-Key')).toBeNull()
    restoreFetch()
  })

  it('returns debug cache headers only when explicitly enabled', async () => {
    const bindings = createBindings({
      DEBUG_CACHE_HEADERS: 'true',
    })
    const restoreFetch = installJwksFetch(bindings)

    const response = await app.fetch(new Request('https://app.test/products/42'), bindings)

    expect(response.headers.get('X-Cache-Key')).toContain('__ck=')
    restoreFetch()
  })

  it('rejects private route access without JWT', async () => {
    const bindings = createBindings()
    const response = await app.fetch(new Request('https://app.test/accounts/acc-1/profile'), bindings)
    expect(response.status).toBe(401)
  })

  it('reuses private cache for the same tenant and isolates mismatched tenants', async () => {
    const bindings = createBindings()
    const restoreFetch = installJwksFetch(bindings, DEV_JWKS)
    const headers = await makeAuthHeader('acc-1')

    const first = await app.fetch(
      new Request('https://app.test/accounts/acc-1/profile', {
        headers,
      }),
      bindings
    )
    const second = await app.fetch(
      new Request('https://app.test/accounts/acc-1/profile', {
        headers,
      }),
      bindings
    )
    const wrongTenantHeaders = await makeAuthHeader('acc-2')
    const forbidden = await app.fetch(
      new Request('https://app.test/accounts/acc-1/profile', {
        headers: wrongTenantHeaders,
      }),
      bindings
    )

    expect(first.headers.get('X-Cache-Status')).toBe('MISS')
    expect(second.headers.get('X-Cache-Status')).toBe('HIT')
    expect(forbidden.status).toBe(403)
    restoreFetch()
  })

  it('stores private cache bodies encrypted and returns decrypted hits', async () => {
    const cache = installMemoryCache()
    const bindings = createBindings()
    const restoreFetch = installJwksFetch(bindings, DEV_JWKS)
    const headers = await makeAuthHeader('acc-1')

    const first = await app.fetch(
      new Request('https://app.test/accounts/acc-1/profile', {
        headers,
      }),
      bindings
    )
    const firstBody = await first.clone().text()
    const second = await app.fetch(
      new Request('https://app.test/accounts/acc-1/profile', {
        headers,
      }),
      bindings
    )
    const secondBody = await second.text()
    const entries = cache.entries()
    const stored = entries.find(([url]) => url.includes('/accounts/acc-1/profile'))?.[1]
    const storedBody = stored ? await stored.clone().text() : ''

    expect(first.headers.get('X-Cache-Status')).toBe('MISS')
    expect(second.headers.get('X-Cache-Status')).toBe('HIT')
    expect(secondBody).toBe(firstBody)
    expect(stored?.headers.get(PRIVATE_CACHE_ENCRYPTION_HEADER)).toBe('aes-256-gcm-v1')
    expect(storedBody).not.toContain('Tenant-acc-1')
    restoreFetch()
  })

  it('does not store private cache entries when the encryption key is missing', async () => {
    const cache = installMemoryCache()
    const bindings = createBindings({
      PRIVATE_CACHE_ENCRYPTION_KEY: '',
    })
    const restoreFetch = installJwksFetch(bindings, DEV_JWKS)
    const headers = await makeAuthHeader('acc-1')

    const first = await app.fetch(
      new Request('https://app.test/accounts/acc-1/profile', {
        headers,
      }),
      bindings
    )
    const second = await app.fetch(
      new Request('https://app.test/accounts/acc-1/profile', {
        headers,
      }),
      bindings
    )

    expect(first.headers.get('X-Cache-Status')).toBe('MISS')
    expect(second.headers.get('X-Cache-Status')).toBe('MISS')
    expect(cache.entries().length).toBe(0)
    restoreFetch()
  })

  it('encrypts sensitive private cache headers at rest and restores them on hit', async () => {
    const cache = installMemoryCache()
    const privateApp = new Hono<AppEnv>()
    privateApp.use('*', async (c, next) => {
      c.set('auth', {
        subject: 'user-1',
        tenantId: 'tenant-secret',
        scopes: [],
        roles: [],
        issuer: 'issuer',
        audience: ['audience'],
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      })
      await next()
    })
    privateApp.get(
      '/private',
      routeCacheMiddleware({
        mode: 'private',
      }),
      (c) => {
        c.header('X-Tenant-Id', 'tenant-secret')
        return c.json({ secret: 'body-secret' })
      }
    )
    const bindings = createBindings()

    const first = await privateApp.fetch(new Request('https://app.test/private'), bindings)
    const second = await privateApp.fetch(new Request('https://app.test/private'), bindings)
    const stored = cache.entries()[0]?.[1]
    const storedBody = stored ? await stored.clone().text() : ''

    expect(first.headers.get('X-Cache-Status')).toBe('MISS')
    expect(second.headers.get('X-Cache-Status')).toBe('HIT')
    expect(second.headers.get('X-Tenant-Id')).toBe('tenant-secret')
    expect(stored?.headers.get('X-Tenant-Id')).toBeNull()
    expect(storedBody).not.toContain('tenant-secret')
    expect(storedBody).not.toContain('body-secret')
  })

  it('records private cache encryption and decryption duration metrics', async () => {
    const bindings = createBindings({
      LOG_LEVEL: 'info',
    })
    const restoreFetch = installJwksFetch(bindings, DEV_JWKS)
    const originalLog = console.log
    const logs: string[] = []
    console.log = (message?: unknown) => {
      logs.push(String(message))
    }

    try {
      const headers = await makeAuthHeader('acc-1')
      await app.fetch(
        new Request('https://app.test/accounts/acc-1/profile', {
          headers,
        }),
        bindings
      )
      await app.fetch(
        new Request('https://app.test/accounts/acc-1/profile', {
          headers,
        }),
        bindings
      )
    } finally {
      console.log = originalLog
      restoreFetch()
    }

    const metrics = logs.map(
      (line) =>
        JSON.parse(line) as {
          level?: string
          name?: string
          value?: string
          valueMs?: string
          valueUs?: number
          displayValue?: string
          bodyBytes?: number
        }
    )
    const encryptMetric = metrics.find((entry) => entry.name === 'cache.private.encrypt.duration_ms')
    const decryptMetric = metrics.find((entry) => entry.name === 'cache.private.decrypt.duration_ms')

    expect(encryptMetric?.displayValue).toMatch(/^\d+\.\d{6} ms$/)
    expect(decryptMetric?.displayValue).toMatch(/^\d+\.\d{6} ms$/)
    expect(encryptMetric?.value).toMatch(/^\d+\.\d{6}$/)
    expect(decryptMetric?.valueMs).toMatch(/^\d+\.\d{6}$/)
    expect(encryptMetric?.valueUs).toBeGreaterThanOrEqual(0)
    expect(encryptMetric?.bodyBytes).toBeGreaterThan(0)
    expect(decryptMetric?.bodyBytes).toBeGreaterThan(0)
  })

  it('records body size metrics for large encrypted private cache bodies', async () => {
    const cache = installMemoryCache()
    const largeBody = 'x'.repeat(128 * 1024)
    const privateApp = new Hono<AppEnv>()
    privateApp.use('*', async (c, next) => {
      c.set('auth', {
        subject: 'user-large',
        tenantId: 'tenant-large',
        scopes: [],
        roles: [],
        issuer: 'issuer',
        audience: ['audience'],
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      })
      await next()
    })
    privateApp.get(
      '/large-private',
      routeCacheMiddleware({
        mode: 'private',
      }),
      (c) => c.text(largeBody)
    )
    const bindings = createBindings({
      LOG_LEVEL: 'info',
    })
    const originalLog = console.log
    const logs: string[] = []
    console.log = (message?: unknown) => {
      logs.push(String(message))
    }

    let first: Response
    let second: Response
    try {
      first = await privateApp.fetch(new Request('https://app.test/large-private'), bindings)
      second = await privateApp.fetch(new Request('https://app.test/large-private'), bindings)
    } finally {
      console.log = originalLog
    }

    const storedBody = await cache.entries()[0][1].clone().text()
    const metrics = logs.map((line) => JSON.parse(line) as { name?: string; bodyBytes?: number; displayValue?: string })
    const encryptMetric = metrics.find((entry) => entry.name === 'cache.private.encrypt.duration_ms')
    const decryptMetric = metrics.find((entry) => entry.name === 'cache.private.decrypt.duration_ms')

    expect(first.headers.get('X-Cache-Status')).toBe('MISS')
    expect(second.headers.get('X-Cache-Status')).toBe('HIT')
    expect(await second.text()).toBe(largeBody)
    expect(storedBody).not.toContain(largeBody.slice(0, 256))
    expect(encryptMetric?.bodyBytes).toBe(largeBody.length)
    expect(decryptMetric?.bodyBytes).toBe(largeBody.length)
    expect(encryptMetric?.displayValue).toMatch(/^\d+\.\d{6} ms$/)
    expect(decryptMetric?.displayValue).toMatch(/^\d+\.\d{6} ms$/)
  })

  it('purges product cache after mutation', async () => {
    const bindings = createBindings()
    const restoreFetch = installJwksFetch(bindings)
    const authHeaders = await makeAuthHeader('acc-1', 'products:write profile:read profile:write')

    await app.fetch(new Request('https://app.test/products/42'), bindings)
    const mutation = await app.fetch(
      new Request('https://app.test/products/42', {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Updated-42' }),
      }),
      bindings
    )
    const after = await app.fetch(new Request('https://app.test/products/42'), bindings)
    const body = (await after.json()) as { name: string }

    expect(mutation.status).toBe(200)
    expect(after.headers.get('X-Cache-Status')).toBe('MISS')
    expect(body.name).toBe('Updated-42')
    restoreFetch()
  })

  it('refreshes JWKS on kid rotation', async () => {
    const bindings = createBindings({
      JWT_JWKS_URL: 'https://issuer.example.test/.well-known/jwks-rotation.json',
    })
    const originalFetch = globalThis.fetch
    const rotatedJwks = {
      keys: [
        {
          ...DEV_JWKS.keys[0],
          kid: 'old-kid',
        },
      ],
    }

    let calls = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === bindings.JWT_JWKS_URL) {
        calls += 1
        return new Response(JSON.stringify(calls === 1 ? rotatedJwks : DEV_JWKS), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }
      return originalFetch(input as RequestInfo, init)
    }) as typeof fetch

    const headers = await makeAuthHeader('acc-1')
    const response = await app.fetch(
      new Request('https://app.test/accounts/acc-1/profile', {
        headers,
      }),
      bindings
    )

    expect(response.status).toBe(200)
    expect(calls).toBeGreaterThanOrEqual(2)
    globalThis.fetch = originalFetch
  })

  it('never caches critical balance responses', async () => {
    const bindings = createBindings()
    const restoreFetch = installJwksFetch(bindings)
    const headers = await makeAuthHeader('acc-1')

    const first = await app.fetch(
      new Request('https://app.test/accounts/acc-1/balance', {
        headers,
      }),
      bindings
    )
    const second = await app.fetch(
      new Request('https://app.test/accounts/acc-1/balance', {
        headers,
      }),
      bindings
    )

    expect(first.headers.get('X-Cache-Status')).toBe('BYPASS')
    expect(second.headers.get('X-Cache-Status')).toBe('BYPASS')
    restoreFetch()
  })

  it('rejects invalid admin purge signatures', async () => {
    const bindings = createBindings()
    const response = await app.fetch(
      new Request('https://app.test/admin/cache/purge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-timestamp': Date.now().toString(),
          'x-admin-signature': 'bad-signature',
        },
        body: JSON.stringify({ tags: ['products'] }),
      }),
      bindings
    )

    expect(response.status).toBe(401)
  })

  it('hard fails tag-only purge requests in simulate mode when required', async () => {
    const bindings = createBindings()
    const body = JSON.stringify({
      tags: ['products'],
      requireSuccessfulPurge: true,
    })
    const headers = await makeAdminHeaders('/admin/cache/purge', body)

    const response = await app.fetch(
      new Request('https://app.test/admin/cache/purge', {
        method: 'POST',
        headers,
        body,
      }),
      bindings
    )

    expect(response.status).toBeGreaterThanOrEqual(500)
  })

  it('soft fails tag-only purge requests in simulate mode when optional', async () => {
    const bindings = createBindings()
    const body = JSON.stringify({
      tags: ['products'],
      requireSuccessfulPurge: false,
    })
    const headers = await makeAdminHeaders('/admin/cache/purge', body)

    const response = await app.fetch(
      new Request('https://app.test/admin/cache/purge', {
        method: 'POST',
        headers,
        body,
      }),
      bindings
    )
    const payload = (await response.json()) as {
      ok: boolean
      result: { ok: boolean; partial?: boolean; unsupportedTags?: string[] }
    }

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.result.ok).toBe(false)
    expect(payload.result.partial).toBe(true)
    expect(payload.result.unsupportedTags).toEqual(['products'])
  })

  it('sanitizes invalid request ids', async () => {
    const bindings = createBindings()
    const restoreFetch = installJwksFetch(bindings)

    const response = await app.fetch(
      new Request('https://app.test/products/42', {
        headers: {
          'x-request-id': 'bad_request_id!',
        },
      }),
      bindings
    )

    expect(response.headers.get('X-Request-Id')).toMatch(/^[A-Za-z0-9-]{8,128}$/)
    expect(response.headers.get('X-Request-Id')).not.toBe('bad_request_id!')
    restoreFetch()
  })

  it('allows public API CORS in non-production', async () => {
    const bindings = createBindings()
    const response = await app.fetch(
      new Request('https://app.test/', {
        headers: {
          Origin: 'https://ui.example.test',
        },
      }),
      bindings
    )

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://ui.example.test')
    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin')
  })

  it('uses env-driven CORS allowlist in production', async () => {
    const bindings = createBindings({
      ENVIRONMENT: 'production',
      CORS_ALLOW_ORIGINS: 'https://ui.example.test',
    })

    const allowed = await app.fetch(
      new Request('https://app.test/', {
        headers: {
          Origin: 'https://ui.example.test',
        },
      }),
      bindings
    )
    const denied = await app.fetch(
      new Request('https://app.test/', {
        headers: {
          Origin: 'https://evil.example.test',
        },
      }),
      bindings
    )

    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://ui.example.test')
    expect(allowed.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin')
    expect(denied.headers.get('Access-Control-Allow-Origin')).not.toBe('https://evil.example.test')
  })
})

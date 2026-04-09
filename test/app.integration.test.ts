import { beforeEach, describe, expect, it } from 'bun:test'
import { createApp } from '../src/index'
import { DEV_JWKS } from '../src/dev/jwks'
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

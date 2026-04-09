import { beforeEach, describe, expect, it } from 'bun:test'
import { createApp } from '../src/index'
import { createBindings, installJwksFetch, installMemoryCache, makeAuthHeader } from './helpers/test-env'

describe('stress regression', () => {
  const app = createApp()

  beforeEach(() => {
    installMemoryCache()
  })

  it('survives mixed tenant traffic, repeated hits, and targeted mutation churn without leakage', async () => {
    const bindings = createBindings()
    const restoreFetch = installJwksFetch(bindings)
    const tenantAHeaders = await makeAuthHeader('acc-a', 'profile:read profile:write products:write')
    const tenantBHeaders = await makeAuthHeader('acc-b', 'profile:read profile:write products:write')

    await Promise.all([
      app.fetch(new Request('https://app.test/products/42'), bindings),
      app.fetch(new Request('https://app.test/accounts/acc-a/profile', { headers: tenantAHeaders }), bindings),
      app.fetch(new Request('https://app.test/accounts/acc-b/profile', { headers: tenantBHeaders }), bindings),
    ])

    for (let round = 0; round < 12; round += 1) {
      const [product, profileA, profileB] = await Promise.all([
        app.fetch(new Request('https://app.test/products/42'), bindings),
        app.fetch(new Request('https://app.test/accounts/acc-a/profile', { headers: tenantAHeaders }), bindings),
        app.fetch(new Request('https://app.test/accounts/acc-b/profile', { headers: tenantBHeaders }), bindings),
      ])

      expect(product.ok).toBe(true)
      expect(profileA.ok).toBe(true)
      expect(profileB.ok).toBe(true)
      expect(product.headers.get('X-Cache-Status')).toBe('HIT')
      expect(profileA.headers.get('X-Cache-Status')).toBe('HIT')
      expect(profileB.headers.get('X-Cache-Status')).toBe('HIT')

      const updateA = await app.fetch(
        new Request('https://app.test/accounts/acc-a/profile', {
          method: 'POST',
          headers: {
            ...tenantAHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ displayName: `Tenant-A-${round}` }),
        }),
        bindings
      )
      expect(updateA.ok).toBe(true)

      const refreshedA = await app.fetch(
        new Request('https://app.test/accounts/acc-a/profile', { headers: tenantAHeaders }),
        bindings
      )
      const refreshedB = await app.fetch(
        new Request('https://app.test/accounts/acc-b/profile', { headers: tenantBHeaders }),
        bindings
      )

      const bodyA = (await refreshedA.json()) as { displayName: string; accountId: string }
      const bodyB = (await refreshedB.json()) as { displayName: string; accountId: string }

      expect(bodyA.accountId).toBe('acc-a')
      expect(bodyB.accountId).toBe('acc-b')
      expect(refreshedA.headers.get('X-Cache-Status')).toBe('MISS')
      expect(refreshedB.headers.get('X-Cache-Status')).toBe('HIT')
      expect(bodyA.displayName).toBe(`Tenant-A-${round}`)
      expect(bodyB.displayName).not.toBe(`Tenant-A-${round}`)
    }

    restoreFetch()
  })
})

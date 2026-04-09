import { describe, expect, it } from 'bun:test'
import { buildCacheKeyUrl } from '../src/cache/cache-key'

describe('buildCacheKeyUrl', () => {
  it('normalizes query parameters deterministically', async () => {
    const first = await buildCacheKeyUrl(new Request('https://example.test/products/1?b=2&a=1'), {
      mode: 'public',
      includeQuery: true,
      varyHeaders: [],
      varyCookies: [],
      version: 'v1',
    })
    const second = await buildCacheKeyUrl(new Request('https://example.test/products/1?a=1&b=2'), {
      mode: 'public',
      includeQuery: true,
      varyHeaders: [],
      varyCookies: [],
      version: 'v1',
    })

    expect(first).toBe(second)
  })

  it('isolates private cache keys by tenant identity', async () => {
    const baseRequest = new Request('https://example.test/me/profile')
    const tenantA = await buildCacheKeyUrl(baseRequest, {
      mode: 'private',
      includeQuery: true,
      varyHeaders: [],
      varyCookies: [],
      identity: ['tenant:acc-a'],
      version: 'v1',
    })
    const tenantB = await buildCacheKeyUrl(baseRequest, {
      mode: 'private',
      includeQuery: true,
      varyHeaders: [],
      varyCookies: [],
      identity: ['tenant:acc-b'],
      version: 'v1',
    })

    expect(tenantA).not.toBe(tenantB)
  })
})

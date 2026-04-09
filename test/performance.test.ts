import { beforeEach, describe, expect, it } from 'bun:test'
import { createApp } from '../src/index'
import { createBindings, installJwksFetch, installMemoryCache, makeAuthHeader } from './helpers/test-env'

describe('performance regression', () => {
  const app = createApp()

  beforeEach(() => {
    installMemoryCache()
  })

  it('keeps warmed public and private cache reads under a loose p95 budget', async () => {
    const bindings = createBindings()
    const restoreFetch = installJwksFetch(bindings)
    const headers = await makeAuthHeader('acc-1')

    await app.fetch(new Request('https://app.test/products/42'), bindings)
    await app.fetch(
      new Request('https://app.test/accounts/acc-1/profile', {
        headers
      }),
      bindings
    )

    const samples: number[] = []
    for (let index = 0; index < 10000; index += 1) {
      const request =
        index % 2 === 0
          ? new Request('https://app.test/products/42')
          : new Request('https://app.test/accounts/acc-1/profile', { headers })

      const started = performance.now()
      const response = await app.fetch(request, bindings)
      const elapsed = performance.now() - started
      samples.push(elapsed)
      expect(response.ok).toBe(true)
      expect(response.headers.get('X-Cache-Status')).toBe('HIT')
    }

    samples.sort((a, b) => a - b)
    const p95 = samples[Math.floor(samples.length * 0.95)]
    expect(p95).toBeLessThan(25)
    restoreFetch()
  })
})

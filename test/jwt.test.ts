import { beforeEach, describe, expect, it } from 'bun:test'
import { createDevJwt } from '../scripts/lib/dev-auth'
import { verifyJwt } from '../src/auth/jwt'
import { createBindings, installJwksFetch } from './helpers/test-env'

describe('verifyJwt', () => {
  let restoreFetch: (() => void) | undefined

  beforeEach(() => {
    restoreFetch?.()
  })

  it('extracts auth context from a valid JWT', async () => {
    const bindings = createBindings()
    restoreFetch = installJwksFetch(bindings)
    const token = await createDevJwt({ accountId: 'acc-42' })

    const auth = await verifyJwt(token, bindings)
    expect(auth.subject).toBe('user-1')
    expect(auth.tenantId).toBe('acc-42')
    expect(auth.scopes).toContain('profile:read')
  })

  it('rejects invalid audience', async () => {
    const bindings = createBindings()
    restoreFetch = installJwksFetch(bindings)
    const token = await createDevJwt({ audience: 'wrong-audience' })

    await expect(verifyJwt(token, bindings)).rejects.toThrow('Invalid JWT audience')
  })
})

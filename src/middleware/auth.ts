// Copy note:
// Use this middleware on routes that need verified tenant identity.
// It is provider-agnostic; swap the resolver registry in `src/auth/resolvers.ts`
// and keep returning the shared `AuthContext`.
import { createMiddleware } from 'hono/factory'
import type { AppEnv, AuthContext } from '../types/env'
import { getDefaultAuthResolver } from '../auth/resolvers'

const BEARER_PREFIX = 'Bearer '

function unauthorized(message: string): Response {
  return Response.json({ error: 'Unauthorized', message }, { status: 401 })
}

function forbidden(message: string): Response {
  return Response.json({ error: 'Forbidden', message }, { status: 403 })
}

function getBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue || !headerValue.startsWith(BEARER_PREFIX)) {
    return null
  }
  return headerValue.slice(BEARER_PREFIX.length).trim() || null
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const resolver = getDefaultAuthResolver(c)
  const token = getBearerToken(c.req.header('Authorization'))
  if (!token) {
    return unauthorized('Missing bearer token')
  }

  let auth: AuthContext
  try {
    auth = await resolver({ token, context: c })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication failed'
    return unauthorized(message)
  }

  const providedAccountId = c.req.header('x-account-id')
  if (providedAccountId && providedAccountId !== auth.tenantId) {
    return forbidden('x-account-id does not match token tenant')
  }

  c.set('auth', auth)
  await next()
})

export const optionalAuth = createMiddleware<AppEnv>(async (c, next) => {
  const resolver = getDefaultAuthResolver(c)
  const token = getBearerToken(c.req.header('Authorization'))
  if (!token) {
    await next()
    return
  }

  try {
    const auth = await resolver({ token, context: c })
    const providedAccountId = c.req.header('x-account-id')
    if (providedAccountId && providedAccountId !== auth.tenantId) {
      return forbidden('x-account-id does not match token tenant')
    }
    c.set('auth', auth)
    await next()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication failed'
    return unauthorized(message)
  }
})

export function requireScope(scope: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const auth = c.get('auth')
    if (!auth) {
      return unauthorized('Authentication required')
    }
    if (!auth.scopes.includes(scope) && !auth.roles.includes('admin')) {
      return forbidden(`Missing required scope: ${scope}`)
    }
    await next()
  })
}

// Copy note:
// This file is the auth provider registry. Keep middleware stable and swap provider-specific
// verification here as long as the resolver returns the shared `AuthContext`.
import type { Context } from 'hono'
import type { AppEnv } from '../types/env'
import type { AuthResolver } from './types'
import { verifyJwt } from './jwt'

export function getDefaultAuthResolver(context: Context<AppEnv>): AuthResolver {
  const provider = (context.env.AUTH_PROVIDER ?? 'jwt').toLowerCase()

  switch (provider) {
    case 'jwt':
    case 'jwks':
    case 'supabase':
    case 'better-auth':
      return async ({ token, context: currentContext }) => verifyJwt(token, currentContext.env)
    default:
      throw new Error(`Unsupported auth provider: ${provider}`)
  }
}

import type { Context } from 'hono'
import type { AppEnv, AuthContext } from '../types/env'

export interface AuthResolverInput {
  token: string
  context: Context<AppEnv>
}

export type AuthResolver = (input: AuthResolverInput) => Promise<AuthContext>

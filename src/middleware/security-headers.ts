import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types/env'

export const securityHeadersMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  await next()
  c.header('Referrer-Policy', 'no-referrer')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  const isProduction = (c.env.ENVIRONMENT ?? 'development').toLowerCase() === 'production'
  const hasConfiguredCors = Boolean(c.env.CORS_ALLOW_ORIGINS?.trim())
  c.header('Cross-Origin-Resource-Policy', !isProduction || hasConfiguredCors ? 'cross-origin' : 'same-origin')
})

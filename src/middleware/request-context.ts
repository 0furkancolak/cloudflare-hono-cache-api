import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types/env'
import { sha256Hex } from '../lib/hash'
import { logInfo } from '../observability/logger'

const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,128}$/

function createRequestId(): string {
  return crypto.randomUUID()
}

function sanitizeRequestId(input: string | undefined): string {
  if (!input) {
    return createRequestId()
  }
  return SAFE_REQUEST_ID_PATTERN.test(input) ? input : createRequestId()
}

async function buildLogLine(c: Context<AppEnv>): Promise<string> {
  const auth = c.get('auth')
  const tenantHash = auth ? (await sha256Hex(auth.tenantId)).slice(0, 16) : undefined
  return JSON.stringify({
    level: 'info',
    requestId: c.get('requestId'),
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    status: c.res.status,
    cacheStatus: c.get('cacheStatus') ?? 'NONE',
    cachePolicy: c.get('cachePolicy') ?? 'NONE',
    subject: auth?.subject,
    tenantHash,
  })
}

export const requestContextMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const requestId = sanitizeRequestId(c.req.header('x-request-id'))
  c.set('requestId', requestId)

  await next()

  c.header('X-Request-Id', requestId)
  logInfo(c.env, JSON.parse(await buildLogLine(c)) as Record<string, unknown>)
})

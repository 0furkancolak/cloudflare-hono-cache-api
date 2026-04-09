// Copy note:
// This service is the production-facing purge adapter.
// In a new project, wire `CLOUDFLARE_ZONE_ID` + `CLOUDFLARE_API_TOKEN` for native purge,
// or keep simulate mode for tests/local development.
import type { Context } from 'hono'
import type { AppEnv, CacheInvalidatePayload, PurgeActor, PurgeResult } from '../types/env'
import { hmacSha256Base64Url } from '../lib/hash'
import { recordMetric } from '../observability/metrics'
import { logError, logInfo } from '../observability/logger'

const DEV_PURGE_HMAC_SECRET = 'development-only-change-me'
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000

export interface PurgeRequest {
  files?: string[]
  tags?: string[]
}

function unique(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))]
}

export function buildPurgeRequest(payload: CacheInvalidatePayload): PurgeRequest {
  return {
    files: unique(payload.files ?? []),
    tags: unique(payload.tags ?? []),
  }
}

function getEnvironment(env: AppEnv['Bindings']): string {
  return (env.ENVIRONMENT ?? 'development').toLowerCase()
}

export function getPurgeHmacSecret(env: AppEnv['Bindings']): string {
  return env.PURGE_HMAC_SECRET ?? (getEnvironment(env) === 'production' ? '' : DEV_PURGE_HMAC_SECRET)
}

export async function verifyPurgeSignature(request: Request, secret: string): Promise<boolean> {
  if (!secret) {
    return false
  }

  const timestamp = request.headers.get('x-admin-timestamp')
  const signature = request.headers.get('x-admin-signature')
  if (!timestamp || !signature) {
    return false
  }

  const timestampMs = Number(timestamp)
  if (!Number.isFinite(timestampMs)) {
    return false
  }

  if (Math.abs(Date.now() - timestampMs) > MAX_SIGNATURE_AGE_MS) {
    return false
  }

  const body = request.clone()
  const bodyText = await body.text()
  const payload = `${timestamp}.${request.method.toUpperCase()}.${new URL(request.url).pathname}.${bodyText}`
  const expected = await hmacSha256Base64Url(secret, payload)
  return expected === signature
}

async function simulatePurge(request: PurgeRequest): Promise<{ unsupportedTags: string[]; partial: boolean }> {
  const cache = caches.default
  for (const file of request.files ?? []) {
    await cache.delete(new Request(file, { method: 'GET' }))
  }

  const unsupportedTags = request.tags ?? []
  return {
    unsupportedTags,
    partial: unsupportedTags.length > 0,
  }
}

async function callCloudflarePurgeApi(env: AppEnv['Bindings'], request: PurgeRequest): Promise<void> {
  const zoneId = env.CLOUDFLARE_ZONE_ID
  const token = env.CLOUDFLARE_API_TOKEN
  if (!zoneId || !token) {
    throw new Error('Missing Cloudflare purge configuration')
  }

  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Cloudflare purge failed (${response.status}): ${text}`)
  }
}

function auditPurge(c: Context<AppEnv>, actor: PurgeActor, request: PurgeRequest, result: PurgeResult): void {
  logInfo(c.env, {
    level: 'audit',
    type: 'cache-purge',
    requestId: c.get('requestId'),
    actor,
    request,
    result,
    ts: new Date().toISOString(),
  })
}

export async function purgeCache(
  c: Context<AppEnv>,
  payload: CacheInvalidatePayload,
  actor: PurgeActor
): Promise<PurgeResult> {
  const request = buildPurgeRequest(payload)
  const mode = c.env.CLOUDFLARE_ZONE_ID && c.env.CLOUDFLARE_API_TOKEN ? 'cloudflare' : 'simulate'
  const requireSuccessfulPurge = payload.requireSuccessfulPurge ?? true

  try {
    let partial = false
    let unsupportedTags: string[] = []
    if (mode === 'cloudflare') {
      await callCloudflarePurgeApi(c.env, request)
    } else {
      const simulateResult = await simulatePurge(request)
      partial = simulateResult.partial
      unsupportedTags = simulateResult.unsupportedTags
      if (request.files?.length === 0 && unsupportedTags.length > 0) {
        throw new Error('Simulate mode does not support tag-only purge requests')
      }
    }

    const result = {
      ok: true,
      mode,
      files: request.files ?? [],
      tags: request.tags ?? [],
      request,
      partial: partial || undefined,
      unsupportedTags: unsupportedTags.length > 0 ? unsupportedTags : undefined,
      error: partial ? 'Simulate mode could not independently resolve purge tags' : undefined,
    } satisfies PurgeResult

    recordMetric('purge.success', 1, { mode }, c.env)
    auditPurge(c, actor, request, result)
    return result
  } catch (error) {
    if (!requireSuccessfulPurge) {
      const message = error instanceof Error ? error.message : 'Unknown purge failure'
      const result = {
        ok: false,
        mode,
        files: request.files ?? [],
        tags: request.tags ?? [],
        request,
        error: message,
        partial: true,
        unsupportedTags: request.tags && request.tags.length > 0 ? request.tags : undefined,
      } satisfies PurgeResult
      recordMetric('purge.failure', 1, { mode, soft: 'true' }, c.env)
      auditPurge(c, actor, request, result)
      return result
    }

    recordMetric('purge.failure', 1, { mode }, c.env)
    const message = error instanceof Error ? error.message : 'Unknown purge failure'
    logError(c.env, {
      level: 'error',
      type: 'cache-purge',
      requestId: c.get('requestId'),
      actor,
      request,
      error: message,
    })
    throw error
  }
}

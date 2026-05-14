import type { AppBindings } from '../types/env'
import { recordMetric } from '../observability/metrics'
import {
  decryptPrivateCacheBytes,
  encryptPrivateCacheBytes,
  getPrivateCacheCryptoKey,
  PRIVATE_CACHE_ENCRYPTION_ALGORITHM,
  PRIVATE_CACHE_ENCRYPTION_HEADER,
  type PrivateCacheEncryptedHeader,
  type PrivateCacheEnvelope,
} from './private-cache-crypto'

const SENSITIVE_PRIVATE_CACHE_HEADERS = [
  'set-cookie',
  'authorization',
  'proxy-authorization',
  'x-account-id',
  'x-user-id',
  'x-tenant-id',
]
const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function getHeaderValues(headers: Headers, name: string): string[] {
  if (name.toLowerCase() === 'set-cookie') {
    const withSetCookie = headers as Headers & { getSetCookie?: () => string[] }
    const values = withSetCookie.getSetCookie?.()
    if (values && values.length > 0) {
      return values
    }
  }

  const value = headers.get(name)
  return value ? [value] : []
}

function deleteSensitiveHeaders(headers: Headers): void {
  for (const name of SENSITIVE_PRIVATE_CACHE_HEADERS) {
    headers.delete(name)
  }
}

function restoreSensitiveHeaders(headers: Headers, envelope: PrivateCacheEnvelope, values: Map<string, string[]>): void {
  for (const item of envelope.headers) {
    headers.delete(item.name)
    for (const value of values.get(item.name.toLowerCase()) ?? []) {
      headers.append(item.name, value)
    }
  }
}

export async function buildEncryptedPrivateCacheResponse(
  response: Response,
  headers: Headers,
  bindings: Partial<AppBindings>
): Promise<Response | null> {
  const key = await getPrivateCacheCryptoKey(bindings)
  if (!key) {
    return null
  }

  const start = nowMs()
  try {
    const plaintextBody = new Uint8Array(await response.arrayBuffer())
    const encryptedHeaders: PrivateCacheEncryptedHeader[] = []
    for (const name of SENSITIVE_PRIVATE_CACHE_HEADERS) {
      const values = getHeaderValues(headers, name)
      if (values.length === 0) {
        continue
      }
      encryptedHeaders.push({
        name,
        values: await Promise.all(values.map((value) => encryptPrivateCacheBytes(key, textEncoder.encode(value)))),
      })
    }

    const storageHeaders = new Headers(headers)
    deleteSensitiveHeaders(storageHeaders)
    storageHeaders.delete('Content-Length')
    storageHeaders.set(PRIVATE_CACHE_ENCRYPTION_HEADER, PRIVATE_CACHE_ENCRYPTION_ALGORITHM)

    const envelope: PrivateCacheEnvelope = {
      alg: PRIVATE_CACHE_ENCRYPTION_ALGORITHM,
      body: await encryptPrivateCacheBytes(key, plaintextBody),
      headers: encryptedHeaders,
    }

    recordMetric('cache.private.encrypt.duration_ms', nowMs() - start, {}, bindings, {
      bodyBytes: plaintextBody.byteLength,
    })
    return new Response(JSON.stringify(envelope), {
      status: response.status,
      statusText: response.statusText,
      headers: storageHeaders,
    })
  } catch (error) {
    recordMetric('cache.private.encrypt.failure', 1, {}, bindings)
    return null
  }
}

export async function decryptPrivateCacheHit(response: Response, bindings: Partial<AppBindings>): Promise<Response | null> {
  if (response.headers.get(PRIVATE_CACHE_ENCRYPTION_HEADER) !== PRIVATE_CACHE_ENCRYPTION_ALGORITHM) {
    return response
  }

  const key = await getPrivateCacheCryptoKey(bindings)
  if (!key) {
    recordMetric('cache.private.decrypt.failure', 1, { reason: 'missing-key' }, bindings)
    return null
  }

  const start = nowMs()
  try {
    const envelope = (await response.json()) as PrivateCacheEnvelope
    if (envelope.alg !== PRIVATE_CACHE_ENCRYPTION_ALGORITHM) {
      recordMetric('cache.private.decrypt.failure', 1, { reason: 'unsupported-algorithm' }, bindings)
      return null
    }

    const decryptedHeaderValues = new Map<string, string[]>()
    for (const item of envelope.headers) {
      decryptedHeaderValues.set(
        item.name.toLowerCase(),
        await Promise.all(item.values.map(async (value) => textDecoder.decode(await decryptPrivateCacheBytes(key, value))))
      )
    }

    const headers = new Headers(response.headers)
    headers.delete(PRIVATE_CACHE_ENCRYPTION_HEADER)
    headers.delete('Content-Length')
    restoreSensitiveHeaders(headers, envelope, decryptedHeaderValues)

    const body = await decryptPrivateCacheBytes(key, envelope.body)
    recordMetric('cache.private.decrypt.duration_ms', nowMs() - start, {}, bindings, {
      bodyBytes: body.byteLength,
    })
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch (error) {
    recordMetric('cache.private.decrypt.failure', 1, {}, bindings)
    return null
  }
}

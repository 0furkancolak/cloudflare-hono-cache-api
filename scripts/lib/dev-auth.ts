import { DEV_PRIVATE_JWK } from '../../src/dev/jwks'
import { encodeBase64Url, utf8 } from '../../src/lib/base64url'
import { hmacSha256Base64Url } from '../../src/lib/hash'

async function importPrivateKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    DEV_PRIVATE_JWK,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  )
}

export interface DevJwtOptions {
  subject?: string
  accountId?: string
  scope?: string
  issuer?: string
  audience?: string
  expiresInSeconds?: number
  roles?: string[]
}

export async function createDevJwt(options: DevJwtOptions = {}): Promise<string> {
  const key = await importPrivateKey()
  const now = Math.floor(Date.now() / 1000)
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: 'dev-rs256',
  }
  const payload = {
    sub: options.subject ?? 'user-1',
    iss: options.issuer ?? 'https://cache-api.local',
    aud: options.audience ?? 'cache-api',
    exp: now + (options.expiresInSeconds ?? 3600),
    nbf: now - 1,
    iat: now,
    jti: crypto.randomUUID(),
    account_id: options.accountId ?? 'acc-1',
    scope: options.scope ?? 'profile:read profile:write products:write admin:health:read',
    roles: options.roles ?? ['developer'],
  }

  const encodedHeader = encodeBase64Url(JSON.stringify(header))
  const encodedPayload = encodeBase64Url(JSON.stringify(payload))
  const signed = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8(`${encodedHeader}.${encodedPayload}`))
  const encodedSignature = encodeBase64Url(new Uint8Array(signed))
  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`
}

export async function createAdminSignature(
  method: string,
  path: string,
  body: string,
  secret: string
): Promise<{ timestamp: string; signature: string }> {
  const timestamp = Date.now().toString()
  const signature = await hmacSha256Base64Url(secret, `${timestamp}.${method.toUpperCase()}.${path}.${body}`)
  return { timestamp, signature }
}

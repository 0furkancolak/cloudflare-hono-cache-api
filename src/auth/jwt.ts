// Copy note:
// This is the default JWKS/JWT verifier. For Supabase Auth or Better Auth you can often keep
// the signature verification here and adapt claim mapping through env or `mapClaimsToAuthContext()`.
import type { AuthContext, AppBindings } from '../types/env'
import { mapClaimsToAuthContext, type GenericAuthClaims } from './claims'
import { decodeBase64Url, decodeBase64UrlJson } from '../lib/base64url'

interface JwtHeader {
  alg?: string
  typ?: string
  kid?: string
}

interface SigningJsonWebKey extends JsonWebKey {
  kid?: string
  alg?: string
  use?: string
}

interface JwtClaims extends GenericAuthClaims {
  account_id?: string
  tenant_id?: string
}

interface JsonWebKeySetResponse {
  keys: SigningJsonWebKey[]
}

interface CachedJwks {
  expiresAt: number
  keysByKid: Map<string, SigningJsonWebKey>
}

const DEFAULT_JWKS_TTL_SECONDS = 300
const DEFAULT_CLOCK_SKEW_SECONDS = 30
const jwksCache = new Map<string, CachedJwks>()

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function toAudienceList(audience: string | string[] | undefined): string[] {
  if (!audience) {
    return []
  }
  return Array.isArray(audience) ? audience : [audience]
}

async function importVerifyKey(jwk: SigningJsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['verify']
  )
}

async function fetchJwks(bindings: AppBindings, forceRefresh = false): Promise<CachedJwks> {
  const cacheKey = bindings.JWT_JWKS_URL
  const ttlSeconds = Number(bindings.JWKS_CACHE_TTL_SECONDS ?? DEFAULT_JWKS_TTL_SECONDS)
  const cached = jwksCache.get(cacheKey)
  const now = Date.now()

  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached
  }

  const response = await fetch(bindings.JWT_JWKS_URL)
  if (!response.ok) {
    throw new Error(`JWKS fetch failed with status ${response.status}`)
  }

  const body = (await response.json()) as JsonWebKeySetResponse
  const keysByKid = new Map<string, SigningJsonWebKey>()

  for (const key of body.keys ?? []) {
    if (key.kid) {
      keysByKid.set(key.kid, key)
    }
  }

  const next = {
    expiresAt: now + ttlSeconds * 1000,
    keysByKid,
  }
  jwksCache.set(cacheKey, next)
  return next
}

async function getVerificationKey(bindings: AppBindings, kid: string): Promise<SigningJsonWebKey> {
  const cached = await fetchJwks(bindings)
  const existing = cached.keysByKid.get(kid)
  if (existing) {
    return existing
  }

  const refreshed = await fetchJwks(bindings, true)
  const key = refreshed.keysByKid.get(kid)
  if (!key) {
    throw new Error('Unknown JWT kid')
  }

  return key
}

function assertRequiredClaim<T>(value: T | undefined, claim: string): T {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required JWT claim: ${claim}`)
  }
  return value
}

async function verifyRs256(parts: string[], header: JwtHeader, bindings: AppBindings): Promise<void> {
  if (header.alg !== 'RS256') {
    throw new Error('Unsupported JWT alg')
  }

  const kid = assertRequiredClaim(header.kid, 'kid')
  const jwk = await getVerificationKey(bindings, kid)
  const key = await importVerifyKey(jwk)
  const payload = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  const signature = decodeBase64Url(parts[2])
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, payload)
  if (!ok) {
    throw new Error('JWT signature verification failed')
  }
}

function validateClaims(claims: JwtClaims, bindings: AppBindings): AuthContext {
  const current = nowInSeconds()
  const skew = DEFAULT_CLOCK_SKEW_SECONDS
  const issuer = assertRequiredClaim(claims.iss, 'iss')
  if (issuer !== bindings.JWT_ISSUER) {
    throw new Error('Invalid JWT issuer')
  }

  const audience = toAudienceList(claims.aud)
  if (!audience.includes(bindings.JWT_AUDIENCE)) {
    throw new Error('Invalid JWT audience')
  }

  const exp = assertRequiredClaim(claims.exp, 'exp')
  if (exp + skew < current) {
    throw new Error('JWT expired')
  }

  if (claims.nbf && claims.nbf - skew > current) {
    throw new Error('JWT not active yet')
  }

  return mapClaimsToAuthContext(
    {
      ...claims,
      iss: issuer,
      aud: audience,
      exp,
    },
    bindings,
    bindings.AUTH_PROVIDER ?? 'jwt'
  )
}

export async function verifyJwt(token: string, bindings: AppBindings): Promise<AuthContext> {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('Malformed JWT')
  }

  const header = decodeBase64UrlJson<JwtHeader>(parts[0])
  const claims = decodeBase64UrlJson<JwtClaims>(parts[1])
  await verifyRs256(parts, header, bindings)
  return validateClaims(claims, bindings)
}

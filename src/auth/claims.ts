import type { AppBindings, AuthContext } from '../types/env'

export interface GenericAuthClaims {
  sub?: string
  iss?: string
  aud?: string | string[]
  exp?: number
  nbf?: number
  iat?: number
  jti?: string
  scope?: string
  roles?: string[]
  [key: string]: unknown
}

function assertRequired<T>(value: T | undefined, field: string): T {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required auth field: ${field}`)
  }
  return value
}

function toStringList(value: unknown): string[] {
  if (!value) {
    return []
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean).sort()
  }
  if (typeof value === 'string') {
    return value
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .sort()
  }
  return [String(value)].filter(Boolean)
}

function readClaim(claims: GenericAuthClaims, configuredKey: string | undefined, fallbackKeys: string[]): unknown {
  if (configuredKey && claims[configuredKey] !== undefined) {
    return claims[configuredKey]
  }
  for (const fallback of fallbackKeys) {
    if (claims[fallback] !== undefined) {
      return claims[fallback]
    }
  }
  return undefined
}

export function mapClaimsToAuthContext(
  claims: GenericAuthClaims,
  bindings: Partial<AppBindings>,
  provider: string
): AuthContext {
  const tenantValue = readClaim(claims, bindings.AUTH_TENANT_CLAIM, [
    'account_id',
    'tenant_id',
    'org_id',
    'workspace_id',
  ])
  const scopeValue = readClaim(claims, bindings.AUTH_SCOPE_CLAIM, ['scope', 'scp', 'permissions'])
  const rolesValue = readClaim(claims, bindings.AUTH_ROLES_CLAIM, ['roles', 'role'])
  const issuer = assertRequired(typeof claims.iss === 'string' ? claims.iss : undefined, 'iss')
  const subject = assertRequired(typeof claims.sub === 'string' ? claims.sub : undefined, 'sub')
  const exp = assertRequired(typeof claims.exp === 'number' ? claims.exp : undefined, 'exp')

  return {
    subject,
    tenantId: assertRequired(typeof tenantValue === 'string' ? tenantValue : undefined, bindings.AUTH_TENANT_CLAIM ?? 'account_id'),
    scopes: toStringList(scopeValue),
    roles: toStringList(rolesValue),
    issuer,
    audience: Array.isArray(claims.aud) ? claims.aud.map((item) => String(item)) : claims.aud ? [String(claims.aud)] : [],
    expiresAt: exp,
    tokenId: typeof claims.jti === 'string' ? claims.jti : undefined,
    provider,
  }
}

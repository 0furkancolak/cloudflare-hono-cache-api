export type CacheStatus = 'HIT' | 'MISS' | 'BYPASS'
export type CachePolicyMode = 'public' | 'private' | 'bypass'

export interface AuthContext {
  subject: string
  tenantId: string
  scopes: string[]
  roles: string[]
  issuer: string
  audience: string[]
  expiresAt: number
  tokenId?: string
  provider?: string
}

export interface PurgeActor {
  type: 'user' | 'service'
  subject: string
  tenantId?: string
}

export interface CacheInvalidatePayload {
  files?: string[]
  tags?: string[]
  reason?: string
  requireSuccessfulPurge?: boolean
}

export interface PurgeResult {
  ok: boolean
  mode: 'cloudflare' | 'simulate'
  files: string[]
  tags: string[]
  request: {
    files?: string[]
    tags?: string[]
  }
  partial?: boolean
  unsupportedTags?: string[]
  error?: string
}

export interface AppBindings {
  ENVIRONMENT?: string
  LOG_LEVEL?: string
  AUTH_PROVIDER?: string
  JWT_JWKS_URL: string
  JWT_ISSUER: string
  JWT_AUDIENCE: string
  AUTH_TENANT_CLAIM?: string
  AUTH_SCOPE_CLAIM?: string
  AUTH_ROLES_CLAIM?: string
  CACHE_KEY_VERSION?: string
  DEBUG_CACHE_HEADERS?: string
  PRIVATE_CACHE_ENCRYPTION_KEY?: string
  JWKS_CACHE_TTL_SECONDS?: string
  CLOUDFLARE_ZONE_ID?: string
  CLOUDFLARE_API_TOKEN?: string
  PURGE_HMAC_SECRET?: string
  CORS_ALLOW_ORIGINS?: string
}

export interface AppVariables {
  cacheStatus?: CacheStatus
  cachePolicy?: CachePolicyMode
  cacheKeyUrl?: string
  requestId?: string
  auth?: AuthContext
}

export type AppEnv = {
  Bindings: AppBindings
  Variables: AppVariables
}

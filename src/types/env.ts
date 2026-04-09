export type CacheStatus = 'HIT' | 'MISS' | 'BYPASS'

export interface CacheInvalidatePayload {
  urls?: string[]
  tags?: string[]
}

export interface AppBindings {
  CACHE_INVALIDATE_SECRET?: string
}

export interface AppVariables {
  cacheStatus?: CacheStatus
  cacheKeyUrl?: string
}

export type AppEnv = {
  Bindings: AppBindings
  Variables: AppVariables
}

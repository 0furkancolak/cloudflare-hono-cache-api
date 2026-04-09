import type { AppBindings } from '../types/env'
import { logInfo } from './logger'

type MetricName =
  | 'cache.public.hit'
  | 'cache.public.miss'
  | 'cache.private.hit'
  | 'cache.private.miss'
  | 'cache.bypass'
  | 'auth.jwt.failure'
  | 'purge.failure'
  | 'purge.success'

export function recordMetric(
  name: MetricName,
  value = 1,
  tags: Record<string, string> = {},
  bindings?: Partial<AppBindings>
): void {
  logInfo(bindings, {
    level: 'metric',
    name,
    value,
    tags,
    ts: new Date().toISOString(),
  })
}

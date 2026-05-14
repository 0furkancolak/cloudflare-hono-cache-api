import type { AppBindings } from '../types/env'
import { logMetric } from './logger'

type MetricName =
  | 'cache.public.hit'
  | 'cache.public.miss'
  | 'cache.private.hit'
  | 'cache.private.miss'
  | 'cache.private.encrypt.duration_ms'
  | 'cache.private.decrypt.duration_ms'
  | 'cache.private.encrypt.failure'
  | 'cache.private.decrypt.failure'
  | 'cache.bypass'
  | 'auth.jwt.failure'
  | 'purge.failure'
  | 'purge.success'

export function recordMetric(
  name: MetricName,
  value = 1,
  tags: Record<string, string> = {},
  bindings?: Partial<AppBindings>,
  fields: Record<string, string | number | boolean> = {}
): void {
  const isDuration = name.endsWith('.duration_ms')
  const formattedValue = value.toFixed(6)
  logMetric(bindings, {
    level: 'metric',
    name,
    value: isDuration ? formattedValue : value,
    ...(isDuration
      ? {
          unit: 'ms',
          valueMs: formattedValue,
          valueUs: Math.round(value * 1000),
          displayValue: `${formattedValue} ms`,
        }
      : {}),
    tags,
    ...fields,
    ts: new Date().toISOString(),
  })
}

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

function formatDurationFields(valueMs: number): {
  unit: 'ms' | 'us'
  valueMs: string
  valueUs: string
  valueNs: number
  displayValue: string
} {
  const valueMsFormatted = valueMs.toFixed(6)
  const valueUsNumber = valueMs * 1000
  const valueUsFormatted = valueUsNumber.toFixed(3)

  if (valueMs < 1) {
    return {
      unit: 'us',
      valueMs: valueMsFormatted,
      valueUs: valueUsFormatted,
      valueNs: Math.round(valueMs * 1_000_000),
      displayValue: `${valueUsFormatted} µs`,
    }
  }

  return {
    unit: 'ms',
    valueMs: valueMsFormatted,
    valueUs: valueUsFormatted,
    valueNs: Math.round(valueMs * 1_000_000),
    displayValue: `${valueMsFormatted} ms`,
  }
}

export function recordMetric(
  name: MetricName,
  value = 1,
  tags: Record<string, string> = {},
  bindings?: Partial<AppBindings>,
  fields: Record<string, string | number | boolean> = {}
): void {
  const isDuration = name.endsWith('.duration_ms')
  const durationFields = isDuration ? formatDurationFields(value) : null
  logMetric(bindings, {
    level: 'metric',
    name,
    value: durationFields ? durationFields.valueMs : value,
    ...(durationFields
      ? {
          unit: durationFields.unit,
          valueMs: durationFields.valueMs,
          valueUs: durationFields.valueUs,
          valueNs: durationFields.valueNs,
          displayValue: durationFields.displayValue,
        }
      : {}),
    tags,
    ...fields,
    ts: new Date().toISOString(),
  })
}

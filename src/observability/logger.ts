import type { AppBindings } from '../types/env'

type LogLevel = 'silent' | 'error' | 'info'

function getLogLevel(bindings: Partial<AppBindings> | undefined): LogLevel {
  const raw = bindings?.LOG_LEVEL?.toLowerCase()
  if (raw === 'silent' || raw === 'error' || raw === 'info') {
    return raw
  }
  if ((bindings?.ENVIRONMENT ?? '').toLowerCase() === 'test') {
    return 'silent'
  }
  return 'info'
}

function shouldLog(bindings: Partial<AppBindings> | undefined, level: Exclude<LogLevel, 'silent'>): boolean {
  const current = getLogLevel(bindings)
  if (current === 'silent') {
    return false
  }
  if (current === 'error') {
    return level === 'error'
  }
  return true
}

export function logInfo(bindings: Partial<AppBindings> | undefined, payload: unknown): void {
  if (!shouldLog(bindings, 'info')) {
    return
  }
  console.log(JSON.stringify(payload))
}

export function logMetric(bindings: Partial<AppBindings> | undefined, payload: unknown): void {
  if (!shouldLog(bindings, 'info')) {
    return
  }
  console.log(JSON.stringify(payload, null, 2))
}

export function logError(bindings: Partial<AppBindings> | undefined, payload: unknown): void {
  if (!shouldLog(bindings, 'error')) {
    return
  }
  console.error(JSON.stringify(payload))
}

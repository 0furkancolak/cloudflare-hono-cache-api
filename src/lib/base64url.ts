const decoder = new TextDecoder()
const encoder = new TextEncoder()

function normalizeBase64(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const remainder = base64.length % 4
  if (remainder === 0) {
    return base64
  }
  return `${base64}${'='.repeat(4 - remainder)}`
}

export function encodeBase64Url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function decodeBase64Url(input: string): Uint8Array {
  const base64 = normalizeBase64(input)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function decodeBase64UrlJson<T>(input: string): T {
  const bytes = decodeBase64Url(input)
  return JSON.parse(decoder.decode(bytes)) as T
}

export function utf8(input: string): Uint8Array {
  return encoder.encode(input)
}

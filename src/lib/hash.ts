import { encodeBase64Url, utf8 } from './base64url'

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8(input))
  return toHex(new Uint8Array(digest))
}

export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8(input))
  return encodeBase64Url(new Uint8Array(digest))
}

export async function hmacSha256Base64Url(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    utf8(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, utf8(payload))
  return encodeBase64Url(new Uint8Array(signature))
}

import type { AppBindings } from '../types/env'
import { decodeBase64Url, encodeBase64Url, utf8 } from '../lib/base64url'

export const PRIVATE_CACHE_ENCRYPTION_ALGORITHM = 'aes-256-gcm-v1'
export const PRIVATE_CACHE_ENCRYPTION_HEADER = 'X-Private-Cache-Encrypted'

const AES_GCM_IV_BYTES = 12
const AES_GCM_KEY_BITS = 256

export interface PrivateCacheEncryptedField {
  iv: string
  ciphertext: string
}

export interface PrivateCacheEncryptedHeader {
  name: string
  values: PrivateCacheEncryptedField[]
}

export interface PrivateCacheEnvelope {
  alg: typeof PRIVATE_CACHE_ENCRYPTION_ALGORITHM
  body: PrivateCacheEncryptedField
  headers: PrivateCacheEncryptedHeader[]
}

async function importPrivateCacheKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', utf8(secret))
  return crypto.subtle.importKey(
    'raw',
    digest,
    {
      name: 'AES-GCM',
      length: AES_GCM_KEY_BITS,
    },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function getPrivateCacheCryptoKey(bindings: Partial<AppBindings>): Promise<CryptoKey | null> {
  const secret = bindings.PRIVATE_CACHE_ENCRYPTION_KEY?.trim()
  if (!secret) {
    return null
  }
  return importPrivateCacheKey(secret)
}

export async function encryptPrivateCacheBytes(key: CryptoKey, bytes: Uint8Array): Promise<PrivateCacheEncryptedField> {
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES))
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    bytes
  )

  return {
    iv: encodeBase64Url(iv),
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
  }
}

export async function decryptPrivateCacheBytes(key: CryptoKey, field: PrivateCacheEncryptedField): Promise<Uint8Array> {
  const iv = decodeBase64Url(field.iv)
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    decodeBase64Url(field.ciphertext)
  )
  return new Uint8Array(plaintext)
}

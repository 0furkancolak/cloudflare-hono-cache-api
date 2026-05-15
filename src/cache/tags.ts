export const CACHE_TAG_KEYS = {
  products: 'products',
  profiles: 'profiles',
  photos: 'photos',
} as const

export function getProductTag(productId: string): string {
  return `product:${productId}`
}

export function getTenantTag(accountId: string): string {
  return `tenant:${accountId}`
}

export function getProfileTag(accountId: string): string {
  return `profile:${accountId}`
}

export function getPhotosFeedTag(accountId: string): string {
  return `photos-feed:${accountId}`
}

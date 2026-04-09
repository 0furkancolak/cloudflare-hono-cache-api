export const CACHE_TAG_KEYS = {
  products: 'products',
  product: 'product',
} as const

export function getProductTag(productId: string): string {
  return `${CACHE_TAG_KEYS.product}:${productId}`
}

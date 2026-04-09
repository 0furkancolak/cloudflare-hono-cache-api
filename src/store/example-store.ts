// Example-only store:
// This file exists only to keep the demo and tests self-contained.
// Do not use this in production. Replace it with a real persistence adapter
// such as D1, KV, R2, or an external database before shipping.

const productStore = new Map<string, { id: string; name: string; updatedAt: string }>()
const profileStore = new Map<string, { accountId: string; displayName: string; updatedAt: string }>()
const balanceStore = new Map<string, { accountId: string; balanceCents: number; updatedAt: string }>()

export function getOrCreateProduct(productId: string): { id: string; name: string; updatedAt: string } {
  const existing = productStore.get(productId)
  if (existing) {
    return existing
  }

  const created = {
    id: productId,
    name: `Product-${productId}`,
    updatedAt: new Date().toISOString(),
  }
  productStore.set(productId, created)
  return created
}

export function setProduct(productId: string, value: { id: string; name: string; updatedAt: string }): void {
  productStore.set(productId, value)
}

export function getOrCreateProfile(accountId: string): {
  accountId: string
  displayName: string
  updatedAt: string
} {
  const existing = profileStore.get(accountId)
  if (existing) {
    return existing
  }

  const created = {
    accountId,
    displayName: `Tenant-${accountId}`,
    updatedAt: new Date().toISOString(),
  }
  profileStore.set(accountId, created)
  return created
}

export function setProfile(
  accountId: string,
  value: { accountId: string; displayName: string; updatedAt: string }
): void {
  profileStore.set(accountId, value)
}

export function getOrCreateBalance(accountId: string): {
  accountId: string
  balanceCents: number
  updatedAt: string
} {
  const existing = balanceStore.get(accountId)
  if (existing) {
    return existing
  }

  const created = {
    accountId,
    balanceCents: 125000,
    updatedAt: new Date().toISOString(),
  }
  balanceStore.set(accountId, created)
  return created
}

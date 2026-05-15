export const PHOTOS_UPSTREAM_URL = 'https://jsonplaceholder.typicode.com/photos'

export type PhotoRecord = {
  albumId: number
  id: number
  title: string
  url: string
  thumbnailUrl: string
}

export type PhotosFeedPayload = {
  source: string
  multiplier: number
  count: number
  fetchedAt: string
  photos: PhotoRecord[]
}

function isPhotoRecord(value: unknown): value is PhotoRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>
  return (
    typeof record.albumId === 'number' &&
    typeof record.id === 'number' &&
    typeof record.title === 'string' &&
    typeof record.url === 'string' &&
    typeof record.thumbnailUrl === 'string'
  )
}

export async function fetchAndExpandPhotos(multiplier = 10): Promise<PhotosFeedPayload> {
  const response = await fetch(PHOTOS_UPSTREAM_URL)
  if (!response.ok) {
    throw new Error(`Upstream photos request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as unknown
  if (!Array.isArray(payload)) {
    throw new Error('Upstream photos response is not an array')
  }

  const items = payload.filter(isPhotoRecord)
  if (items.length === 0) {
    throw new Error('Upstream photos response has no valid photo records')
  }

  const photos = Array.from({ length: multiplier }, () => items).flat()

  return {
    source: PHOTOS_UPSTREAM_URL,
    multiplier,
    count: photos.length,
    fetchedAt: new Date().toISOString(),
    photos,
  }
}

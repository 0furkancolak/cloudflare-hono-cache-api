import { createDevJwt } from './lib/dev-auth'

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3497'
const durationSeconds = Number(process.env.DURATION_SECONDS ?? 10)
const concurrency = Number(process.env.CONCURRENCY ?? 16)
const accountId = process.env.ACCOUNT_ID ?? 'acc-1'
const token = await createDevJwt({ accountId })

let total = 0
let failures = 0
const samples: number[] = []
const startedAt = Date.now()

async function hit(url: string, headers?: HeadersInit): Promise<void> {
  const requestStarted = performance.now()
  const response = await fetch(url, { headers })
  const elapsed = performance.now() - requestStarted
  samples.push(elapsed)
  total += 1
  if (!response.ok) {
    failures += 1
  }
}

async function worker(index: number): Promise<void> {
  while (Date.now() - startedAt < durationSeconds * 1000) {
    if (index % 2 === 0) {
      await hit(`${baseUrl}/products/42`)
      continue
    }

    await hit(`${baseUrl}/accounts/${accountId}/profile`, {
      Authorization: `Bearer ${token}`,
      'x-account-id': accountId,
    })
  }
}

await Promise.all([...Array(concurrency).keys()].map((index) => worker(index)))
samples.sort((a, b) => a - b)
const percentile = (value: number): number => {
  if (samples.length === 0) {
    return 0
  }
  return samples[Math.min(samples.length - 1, Math.floor(samples.length * value))]
}

console.log(
  JSON.stringify(
    {
      ok: failures === 0,
      durationSeconds,
      concurrency,
      total,
      failures,
      p50Ms: Number(percentile(0.5).toFixed(2)),
      p95Ms: Number(percentile(0.95).toFixed(2)),
      p99Ms: Number(percentile(0.99).toFixed(2)),
    },
    null,
    2
  )
)

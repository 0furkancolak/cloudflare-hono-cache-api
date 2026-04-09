import { createAdminSignature } from './lib/dev-auth'

const method = process.env.METHOD ?? 'POST'
const path = process.env.PATHNAME ?? '/admin/cache/purge'
const body = process.env.BODY ?? '{}'
const secret = process.env.PURGE_HMAC_SECRET ?? 'development-only-change-me'

const { timestamp, signature } = await createAdminSignature(method, path, body, secret)
console.log(JSON.stringify({ timestamp, signature }))

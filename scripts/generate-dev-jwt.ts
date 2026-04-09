import { createDevJwt } from './lib/dev-auth'

const token = await createDevJwt({
  subject: process.env.SUBJECT,
  accountId: process.env.ACCOUNT_ID,
  scope: process.env.SCOPE,
  issuer: process.env.JWT_ISSUER,
  audience: process.env.JWT_AUDIENCE,
})

console.log(token)
